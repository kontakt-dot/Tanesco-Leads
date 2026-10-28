import { describe, expect, it } from "vitest";
import { fixTreeQuestions, recipientValues, smoothQualifyPhrase, starterTree, thirdPartyTemplate } from "../shared/email-campaigns";
import { starterBlocks } from "../shared/email-design";
import { applyPayFit, detectSparte, fitsSparte, fixQuestionCount, foreignSparteIn, mentionsPayFit, mentionsQuestions, PAY_FIT_SENTENCE, qualifyBy, qualifyPhrase, questionCount, resolveSparte, sparteOf, withSparte, questionTopics, SPARTEN, withQuestionTopics } from "../shared/lead-sparte";
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
    expect(third.text).toContain("im Bereich Hausnotruf"); expect(third.text).not.toMatch(/Photovoltaik|Wärmepumpe/); expect(third.text).toContain("Rückmeldung eines Anbieters");
    expect(ensureFacts("Sehr geehrte Damen und Herren,\n\nkurzer Text.", false, "Anbieter")).toContain("dass sich ein Anbieter bei ihm meldet");
    expect(thirdPartyTemplate({ firma: "Solar GmbH" }).text).toContain("im Bereich Photovoltaik und Wärmepumpen"); // Standard bleibt wie bisher
  });
  it("„Sie zahlen nur für Leads, die passen“: nur bei PV & WP – im freien Vorschlag immer, in anderen Sparten nie", () => {
    const pv = resolveSparte("PV & WP")!; const hausnotruf = resolveSparte("Hausnotruf")!;
    const draft = "Sehr geehrter Herr Wiebe,\n\nauf Ihrer Website steht etwas Konkretes.\n\nWenn das für Sie interessant ist, antworten Sie einfach auf diese E-Mail.\n\nVielen Dank";
    const withFit = applyPayFit(draft, { sparte: pv, approach: "frei" });
    expect(withFit).toContain(PAY_FIT_SENTENCE); expect(withFit.indexOf(PAY_FIT_SENTENCE)).toBeLessThan(withFit.indexOf("Wenn das für Sie interessant ist")); // vor dem Schluss
    expect(applyPayFit(withFit, { sparte: pv, approach: "frei" })).toBe(withFit); // nie doppelt
    expect(applyPayFit(draft, { sparte: pv, approach: "frei", followUp: true })).toBe(draft); // Nachfass-Mail: kein Muss
    expect(applyPayFit(draft, { sparte: pv, approach: "drittanbieter" })).toBe(draft);
    expect(applyPayFit(draft, { sparte: pv, approach: "individuell" })).toBe(draft); // den individuellen Ansatz gibt es nicht mehr
    const wrong = "Sehr geehrte Damen und Herren,\n\nunsere Hausnotruf-Leads sind exklusiv. Sie zahlen nur für Leads, die zu Ihnen passen. Keine Vorkasse.\n\nVielen Dank";
    const cleaned = applyPayFit(wrong, { sparte: hausnotruf, approach: "frei" });
    expect(mentionsPayFit(cleaned)).toBe(false); expect(cleaned).toContain("unsere Hausnotruf-Leads sind exklusiv."); expect(cleaned).toContain("Keine Vorkasse.");
    for (const text of ["Bezahlt werden nur passende Leads.", "Abgerechnet werden ausschließlich Leads, die passen.", "Sie zahlen nur für Anfragen, die wirklich passen."]) expect(mentionsPayFit(text)).toBe(true);
    expect(mentionsPayFit("Keine Vorkasse, keine lange Vertragsbindung.")).toBe(false);
    // ganzer Entwurf: PV bekommt den Satz, Hausnotruf nie
    expect(finishDraft("Sehr geehrter Herr Wiebe,\n\nkurzer Text.", { greeting: "Sehr geehrter Herr Wiebe", phone: "", followUp: false, sparte: pv, approach: "frei" })).toContain(PAY_FIT_SENTENCE);
    expect(finishDraft("Sehr geehrte Damen und Herren,\n\nSie zahlen nur für Leads, die passen.", { greeting: "Sehr geehrte Damen und Herren", phone: "", followUp: false, sparte: hausnotruf, approach: "frei", partner: "Anbieter" })).not.toMatch(/zahlen nur/);
    expect(thirdPartyTemplate({ firma: "Solar GmbH" }, pv).text).toContain("Sie zahlen nur für Leads, die zu Ihnen passen");
    expect(thirdPartyTemplate({ firma: "Notruf GmbH" }, hausnotruf).text).not.toMatch(/zahlen nur/);
  });
});

describe("Zahl der Fragen je Sparte: Hausnotruf 6, Elektrorollstuhl 6, Alarmanlage 8, PV & WP 10", () => {
  const hausnotruf = resolveSparte("Hausnotruf")!; const alarm = resolveSparte("Alarmanlage")!; const rollstuhl = resolveSparte("Elektrorollstuhl")!; const pv = resolveSparte("PV & WP")!; const pflegebox = resolveSparte("Pflegebox")!;
  it("die Zahlen und die Formulierung", () => {
    expect([hausnotruf, rollstuhl, alarm, pv, resolveSparte("Photovoltaik")!, resolveSparte("Wärmepumpe")!].map((sparte) => questionCount(sparte))).toEqual([6, 6, 8, 10, 10, 10]);
    expect(questionCount(pflegebox)).toBeNull(); expect(questionCount(resolveSparte("Pool-Bau"))).toBeNull(); expect(questionCount(null)).toBe(10); // ohne Sparte: Standard PV & WP
    expect(questionCount({ ...hausnotruf, source: "erkannt" } as never)).toBe(6); // Sparte einer Kampagne (mit Herkunft)
    // Zahl der Fragen und in Klammern ein kurzer Teaser, worum es bei den Fragen geht
    expect(qualifyPhrase(hausnotruf)).toBe("in der Regel anhand von sechs Fragen (z. B. Krankenkasse, Pflegegrad und Wohnsituation) telefonisch vorqualifiziert");
    expect(qualifyPhrase(alarm)).toBe("in der Regel anhand von acht Fragen (z. B. Objekt und Fläche, Anzahl der Fenster sowie Art der Alarmanlage) telefonisch vorqualifiziert");
    expect(qualifyPhrase(pv)).toBe("in der Regel anhand von zehn Fragen (z. B. Eigentum, Dach und Heizung sowie Stromverbrauch) telefonisch vorqualifiziert");
    expect(qualifyPhrase(pflegebox)).toBe("anhand gezielter Fragen (z. B. Pflegegrad, Pflegekasse und Pflege zu Hause) telefonisch vorqualifiziert"); // ohne feste Zahl: keine Zahl behaupten
    expect(qualifyPhrase(resolveSparte("Pool-Bau"))).toBe("anhand gezielter Fragen telefonisch vorqualifiziert"); // neue Sparte: keine festen Punkte – die KI nennt drei passende
    expect(qualifyBy(rollstuhl)).toBe("anhand von in der Regel sechs Fragen (z. B. Krankenkasse, Pflegegrad und Nutzung drinnen oder draußen)"); expect(qualifyBy(pflegebox)).toBe("anhand gezielter Fragen (z. B. Pflegegrad, Pflegekasse und Pflege zu Hause)");
    expect(questionTopics(hausnotruf)).toEqual(["Krankenkasse", "Pflegegrad", "Wohnsituation"]); expect(questionTopics(resolveSparte("Pool-Bau"))).toBeNull(); expect(questionTopics(null)).toEqual(questionTopics(pv)); // ohne Sparte: Standard PV & WP
    expect(SPARTEN.every((item) => item.topics?.length === 3)).toBe(true); // jede bekannte Sparte hat drei Punkte
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
  it("Pflichtsätze, Drittanbieter-Vorlage und fertige KI-Entwürfe mit der richtigen Zahl", () => {
    expect(ensureFacts("Sehr geehrte Damen und Herren,\n\nkurzer Text.", false, "Anbieter", hausnotruf)).toContain("in der Regel anhand von sechs Fragen (z. B. Krankenkasse, Pflegegrad und Wohnsituation) telefonisch vorqualifiziert");
    expect(ensureFacts("Sehr geehrte Damen und Herren,\n\nkurzer Text.", false, "Fachbetrieb", alarm)).toContain("acht Fragen");
    const has = "Sehr geehrte Damen und Herren,\n\nUnsere Leads sind in der Regel anhand von sechs Fragen telefonisch vorqualifiziert. 20 Test-Leads kostenlos.";
    expect(ensureFacts(has, false, "Anbieter", hausnotruf)).toBe(has); // schon drin – kein zweiter Satz
    expect(thirdPartyTemplate({ firma: "Wachschutz Nord GmbH" }, alarm).text).toContain("anhand von in der Regel acht Fragen");
    expect(thirdPartyTemplate({ firma: "Notruf Nord GmbH" }, hausnotruf).text).toContain("anhand von in der Regel sechs Fragen");
    expect(thirdPartyTemplate({ firma: "Box GmbH" }, pflegebox).text).toContain("anhand gezielter Fragen");
    expect(thirdPartyTemplate({ firma: "Solar GmbH" }).text).toContain("anhand von in der Regel zehn Fragen"); // Standard bleibt
    // die KI übernimmt „zehn“ aus der Vorlage → im fertigen Entwurf steht trotzdem die Zahl der Sparte
    const ai = "Sehr geehrter Herr Wiebe,\n\nIhre Notrufzentrale ist rund um die Uhr besetzt. Unsere Hausnotruf-Leads sind in der Regel anhand von zehn Fragen telefonisch vorqualifiziert. Zum Kennenlernen: 20 Test-Leads kostenlos.";
    const done = finishDraft(ai, { greeting: "Sehr geehrter Herr Wiebe", phone: "", followUp: false, partner: "Anbieter", sparte: hausnotruf, approach: "frei" });
    expect(done).toContain("anhand von sechs Fragen (z. B. Krankenkasse, Pflegegrad und Wohnsituation)"); expect(done).not.toMatch(/zehn Fragen/);
    expect(thirdPartyTemplate({ firma: "Notruf Nord GmbH" }, hausnotruf).text).toContain("sechs Fragen (z. B. Krankenkasse, Pflegegrad und Wohnsituation)");
  });
  it("Teaser in Klammern: nur in Sätzen über die Qualifizierung, nie doppelt, fremde Teaser werden ersetzt", () => {
    const text = "Unsere Anfragen werden in der Regel anhand von sechs Fragen telefonisch vorqualifiziert.";
    const once = withQuestionTopics(text, hausnotruf); expect(once).toBe("Unsere Anfragen werden in der Regel anhand von sechs Fragen (z. B. Krankenkasse, Pflegegrad und Wohnsituation) telefonisch vorqualifiziert.");
    expect(withQuestionTopics(once, hausnotruf)).toBe(once); // schon da
    expect(withQuestionTopics("Jeder Lead wird anhand von sechs Fragen zu Krankenkasse und Pflegegrad geprüft.", hausnotruf)).toBe("Jeder Lead wird anhand von sechs Fragen zu Krankenkasse und Pflegegrad geprüft."); // Punkte stehen schon im Satz
    expect(withQuestionTopics("Ich hätte fünf kurze Fragen zu Ihrem Betrieb.", hausnotruf)).toBe("Ich hätte fünf kurze Fragen zu Ihrem Betrieb."); // keine Qualifizierung
    const own = "Unsere Leads sind anhand von acht Fragen (z. B. Objekt, Fenster und Türen) vorqualifiziert."; expect(withQuestionTopics(own, alarm)).toBe(own); // eigener Teaser der KI bleibt
    const pvText = withQuestionTopics("Unsere Anfragen werden in der Regel anhand von zehn Fragen telefonisch vorqualifiziert.", pv);
    expect(withQuestionTopics(fixQuestionCount(pvText, resolveSparte("Pool-Bau")), resolveSparte("Pool-Bau"))).toBe("Unsere Anfragen werden anhand gezielter Fragen telefonisch vorqualifiziert."); // fremder Teaser fällt bei neuer Sparte weg
    expect(fixQuestionCount(once, alarm)).toContain("acht Fragen (z. B. Krankenkasse"); // die Zahl ändert sich, der Teaser bleibt bis withQuestionTopics …
    expect(withQuestionTopics(fixQuestionCount(once, alarm), alarm)).toBe("Unsere Anfragen werden in der Regel anhand von acht Fragen (z. B. Objekt und Fläche, Anzahl der Fenster sowie Art der Alarmanlage) telefonisch vorqualifiziert."); // … der ihn ersetzt
  });
  it("Vorlagen im Ablauf: Hausnotruf bekommt sechs Fragen, PV & WP bleibt bei zehn", () => {
    const tree = starterTree({ first: [{ id: "t", type: "text", text: "Unsere Anfragen werden in der Regel anhand von zehn Fragen telefonisch vorqualifiziert." }, { id: "b", type: "bullets", items: ["In der Regel anhand von zehn Fragen telefonisch vorqualifiziert", "Keine Vorkasse"] }], followUp: [{ id: "f", type: "text", text: "Kurz nachgefragt – unsere Leads sind über 10 Fragen qualifiziert." }] });
    const fixed = fixTreeQuestions(tree, hausnotruf)!; const text = JSON.stringify(fixed);
    // Teaser in Klammern – einmal je E-Mail (in der Aufzählung derselben E-Mail nicht noch einmal)
    expect(text).toContain("anhand von sechs Fragen (z. B. Krankenkasse, Pflegegrad und Wohnsituation) telefonisch vorqualifiziert."); expect(text).toContain("In der Regel anhand von sechs Fragen telefonisch vorqualifiziert"); expect(text).not.toContain("zehn Fragen"); expect(text).toContain("über sechs Fragen (z. B. Krankenkasse, Pflegegrad und Wohnsituation) qualifiziert");
    const pvTree = fixTreeQuestions(tree, pv)!; expect(JSON.stringify(pvTree)).toContain("zehn Fragen (z. B. Eigentum, Dach und Heizung sowie Stromverbrauch)"); // PV & WP: Zahl bleibt, Teaser kommt dazu
    expect(fixTreeQuestions(pvTree, pv)).toBeNull(); expect(fixTreeQuestions(fixed, hausnotruf)).toBeNull(); // mehrfach ohne Nebenwirkung
    const toAlarm = JSON.stringify(fixTreeQuestions(fixed, alarm)); expect(toAlarm).toContain("acht Fragen (z. B. Objekt und Fläche, Anzahl der Fenster sowie Art der Alarmanlage)"); expect(toAlarm).not.toContain("Krankenkasse"); // kopierte Vorlage: Teaser der anderen Sparte wird ersetzt
  });
});
