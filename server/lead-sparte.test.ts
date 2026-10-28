import { describe, expect, it } from "vitest";
import { fixTreeQuestions, recipientValues, smoothQualifyPhrase, starterTree, thirdPartyTemplate } from "../shared/email-campaigns";
import { starterBlocks } from "../shared/email-design";
import { applyPayFit, detectSparte, fitsSparte, fixQuestionCount, foreignSparteIn, mentionsPayFit, mentionsQuestions, PAY_FIT_SENTENCE, qualifyBy, qualifyPhrase, questionCount, resolveSparte, sparteOf, withSparte } from "../shared/lead-sparte";
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
  it("„Sie zahlen nur für Leads, die passen“: nur bei PV & WP – im individuellen Ansatz immer, in anderen Sparten nie", () => {
    const pv = resolveSparte("PV & WP")!; const hausnotruf = resolveSparte("Hausnotruf")!;
    const draft = "Sehr geehrter Herr Wiebe,\n\nauf Ihrer Website steht etwas Konkretes.\n\nWenn das für Sie interessant ist, antworten Sie einfach auf diese E-Mail.\n\nVielen Dank";
    const withFit = applyPayFit(draft, { sparte: pv, approach: "individuell" });
    expect(withFit).toContain(PAY_FIT_SENTENCE); expect(withFit.indexOf(PAY_FIT_SENTENCE)).toBeLessThan(withFit.indexOf("Wenn das für Sie interessant ist")); // vor dem Schluss
    expect(applyPayFit(withFit, { sparte: pv, approach: "individuell" })).toBe(withFit); // nie doppelt
    expect(applyPayFit(draft, { sparte: pv, approach: "individuell", followUp: true })).toBe(draft); // Nachfass-Mail: kein Muss
    expect(applyPayFit(draft, { sparte: pv, approach: "drittanbieter" })).toBe(draft);
    const wrong = "Sehr geehrte Damen und Herren,\n\nunsere Hausnotruf-Leads sind exklusiv. Sie zahlen nur für Leads, die zu Ihnen passen. Keine Vorkasse.\n\nVielen Dank";
    const cleaned = applyPayFit(wrong, { sparte: hausnotruf, approach: "individuell" });
    expect(mentionsPayFit(cleaned)).toBe(false); expect(cleaned).toContain("unsere Hausnotruf-Leads sind exklusiv."); expect(cleaned).toContain("Keine Vorkasse.");
    for (const text of ["Bezahlt werden nur passende Leads.", "Abgerechnet werden ausschließlich Leads, die passen.", "Sie zahlen nur für Anfragen, die wirklich passen."]) expect(mentionsPayFit(text)).toBe(true);
    expect(mentionsPayFit("Keine Vorkasse, keine lange Vertragsbindung.")).toBe(false);
    // ganzer Entwurf: PV bekommt den Satz, Hausnotruf nie
    expect(finishDraft("Sehr geehrter Herr Wiebe,\n\nkurzer Text.", { greeting: "Sehr geehrter Herr Wiebe", phone: "", followUp: false, sparte: pv, approach: "individuell" })).toContain(PAY_FIT_SENTENCE);
    expect(finishDraft("Sehr geehrte Damen und Herren,\n\nSie zahlen nur für Leads, die passen.", { greeting: "Sehr geehrte Damen und Herren", phone: "", followUp: false, sparte: hausnotruf, approach: "individuell", partner: "Anbieter" })).not.toMatch(/zahlen nur/);
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
    expect(qualifyPhrase(hausnotruf)).toBe("in der Regel anhand von sechs Fragen telefonisch vorqualifiziert");
    expect(qualifyPhrase(alarm)).toBe("in der Regel anhand von acht Fragen telefonisch vorqualifiziert");
    expect(qualifyPhrase(pv)).toBe("in der Regel anhand von zehn Fragen telefonisch vorqualifiziert");
    expect(qualifyPhrase(pflegebox)).toBe("anhand gezielter Fragen telefonisch vorqualifiziert"); // ohne feste Zahl: keine Zahl behaupten
    expect(qualifyBy(rollstuhl)).toBe("anhand von in der Regel sechs Fragen"); expect(qualifyBy(pflegebox)).toBe("anhand gezielter Fragen");
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
    expect(ensureFacts("Sehr geehrte Damen und Herren,\n\nkurzer Text.", false, "Anbieter", hausnotruf)).toContain("in der Regel anhand von sechs Fragen telefonisch vorqualifiziert");
    expect(ensureFacts("Sehr geehrte Damen und Herren,\n\nkurzer Text.", false, "Fachbetrieb", alarm)).toContain("acht Fragen");
    const has = "Sehr geehrte Damen und Herren,\n\nUnsere Leads sind in der Regel anhand von sechs Fragen telefonisch vorqualifiziert. 20 Test-Leads kostenlos.";
    expect(ensureFacts(has, false, "Anbieter", hausnotruf)).toBe(has); // schon drin – kein zweiter Satz
    expect(thirdPartyTemplate({ firma: "Wachschutz Nord GmbH" }, alarm).text).toContain("anhand von in der Regel acht Fragen");
    expect(thirdPartyTemplate({ firma: "Notruf Nord GmbH" }, hausnotruf).text).toContain("anhand von in der Regel sechs Fragen");
    expect(thirdPartyTemplate({ firma: "Box GmbH" }, pflegebox).text).toContain("anhand gezielter Fragen");
    expect(thirdPartyTemplate({ firma: "Solar GmbH" }).text).toContain("anhand von in der Regel zehn Fragen"); // Standard bleibt
    // die KI übernimmt „zehn“ aus der Vorlage → im fertigen Entwurf steht trotzdem die Zahl der Sparte
    const ai = "Sehr geehrter Herr Wiebe,\n\nIhre Notrufzentrale ist rund um die Uhr besetzt. Unsere Hausnotruf-Leads sind in der Regel anhand von zehn Fragen telefonisch vorqualifiziert. Zum Kennenlernen: 20 Test-Leads kostenlos.";
    const done = finishDraft(ai, { greeting: "Sehr geehrter Herr Wiebe", phone: "", followUp: false, partner: "Anbieter", sparte: hausnotruf, approach: "individuell" });
    expect(done).toContain("anhand von sechs Fragen"); expect(done).not.toMatch(/zehn Fragen/);
  });
  it("Vorlagen im Ablauf: Hausnotruf bekommt sechs Fragen, PV & WP bleibt bei zehn", () => {
    const tree = starterTree({ first: [{ id: "t", type: "text", text: "Unsere Anfragen werden in der Regel anhand von zehn Fragen telefonisch vorqualifiziert." }, { id: "b", type: "bullets", items: ["In der Regel anhand von zehn Fragen telefonisch vorqualifiziert", "Keine Vorkasse"] }], followUp: [{ id: "f", type: "text", text: "Kurz nachgefragt – unsere Leads sind über 10 Fragen qualifiziert." }] });
    const fixed = fixTreeQuestions(tree, hausnotruf)!; const text = JSON.stringify(fixed);
    expect(text).toContain("anhand von sechs Fragen telefonisch vorqualifiziert."); expect(text).toContain("In der Regel anhand von sechs Fragen"); expect(text).not.toContain("zehn Fragen"); expect(text).toContain("über sechs Fragen qualifiziert");
    expect(fixTreeQuestions(tree, pv)).toBeNull(); // nichts zu ändern
    expect(fixTreeQuestions(fixed, hausnotruf)).toBeNull();
  });
});
