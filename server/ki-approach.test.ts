import { describe, expect, it } from "vitest";
import { approachLabel, approachOf, autoDraftFor, copiesTemplate, DRAFT_APPROACHES, dropThirdPartyClaim, fitsApproach, KI_ANSATZ_OPTIONS, kiAnsatzOf } from "../shared/email-campaigns";

const individual = "Sehr geehrter Herr Wiebe,\n\nauf Ihrer Website steht „Keine Anzahlung, 0 % Risiko“. Genau so arbeiten wir auch.";
const thirdParty = "Sehr geehrter Herr Wiebe,\n\nsehr wahrscheinlich kommen bei Ihnen Leads an, die ohnehin von uns stammen – nur über Zwischenhändler weitergereicht.";
const options = [{ key: "frei", label: "Freier Vorschlag", subject: "Ihr Versprechen ohne Anzahlung", text: `${individual} Mehr Text, damit es lang genug ist.` }, { key: "drittanbieter", label: "Drittanbieter-Ansatz", subject: "Direkte Zusammenarbeit", text: `${thirdParty} Mehr Text, damit es lang genug ist.` }];

describe("KI-Ansatz: es geht nur der gewählte Ansatz raus", () => {
  it("nur noch zwei Ansätze: Drittanbieter und freier Vorschlag – alte Kampagnen mit „individuell“ gelten als frei", () => {
    expect(DRAFT_APPROACHES.map((item) => item.key)).toEqual(["drittanbieter", "frei"]);
    expect(KI_ANSATZ_OPTIONS.map((item) => item.key)).toEqual(["drittanbieter", "frei"]); // Auswahl im Builder
    expect(KI_ANSATZ_OPTIONS.map((item) => item.label)).toEqual(["Drittanbieter-Ansatz", "Freier Vorschlag"]);
    expect(kiAnsatzOf({ kiAnsatz: "individuell" })).toBe("frei"); expect(kiAnsatzOf({ kiAnsatz: null })).toBe("frei"); expect(kiAnsatzOf({})).toBe("frei"); expect(kiAnsatzOf({ kiAnsatz: "drittanbieter" })).toBe("drittanbieter"); expect(kiAnsatzOf({ kiAnsatz: "frei" })).toBe("frei");
    expect(approachOf("individuell")).toBeNull(); expect(approachOf("frei")).toBe("frei"); expect(approachOf("drittanbieter")).toBe("drittanbieter"); expect(approachOf(null)).toBeNull();
    expect(approachLabel("frei")).toBe("Freier Vorschlag"); expect(approachLabel("individuell")).toBe("Individueller Ansatz (alt)");
  });
  it("freier Vorschlag ohne Drittanbieter-Kernbotschaft – Drittanbieter wird nicht beschnitten", () => {
    expect(fitsApproach("frei", individual)).toBe(true);
    expect(fitsApproach("frei", thirdParty)).toBe(false);
    expect(fitsApproach("frei", "Ihre Anfragen stammen sehr wahrscheinlich von uns – nur eben über Umwege.")).toBe(false);
    expect(fitsApproach("frei", "Unsere Leads landen über Zwischenhändler bei Ihnen.")).toBe(false);
    // allgemeiner Ärger mit Lead-Anbietern darf in den freien Vorschlag – das ist NICHT die Drittanbieter-Kernbotschaft (früher fälschlich verworfen → Vorlage statt KI-Text)
    expect(fitsApproach("frei", "Viele Drittanbieter verkaufen dieselbe Anfrage an mehrere Betriebe – bei uns geht jeder Lead nur an Sie.")).toBe(true);
    expect(fitsApproach("frei", "Wer Leads über Zwischenhändler einkauft, kennt falsche Nummern und Vorkasse.")).toBe(true);
    // ganz normale Sätze über unser Angebot – wurden früher fälschlich aussortiert (dann kam die Vorlage statt des KI-Textes)
    for (const text of ["Unsere Leads werden nicht an Dritte weiterverkauft – jede Anfrage geht nur an Sie.", "Unsere Anfragen kommen ohne Umweg über Portale direkt zu Ihnen.", "Die Leads stammen aus unserer eigenen Generierung über Facebook und Instagram.", "Viele Drittanbieter verkaufen dieselbe Anfrage an mehrere Betriebe – unsere Leads gehen exklusiv an Sie.", "Unsere Interessenten stammen von unseren eigenen Kampagnen.", "Unsere Leads werden nicht über Zwischenhändler verkauft.", "Vermutlich haben Sie schon von uns gehört."]) expect(fitsApproach("frei", text)).toBe(true);
    for (const text of ["Die Leads, die Sie heute über Zwischenhändler kaufen, stammen oft von uns.", "Wir gehen davon aus, dass Sie schon Leads von uns bekommen – nur über Umwege."]) expect(fitsApproach("frei", text)).toBe(false);
    // steht die Kernbotschaft doch im freien Vorschlag, fliegt nur dieser Satz raus – der Rest des KI-Textes bleibt
    const mixed = "Sehr geehrter Herr Wiebe,\n\nIhre Notrufzentrale ist rund um die Uhr besetzt. Sehr wahrscheinlich stammen Ihre Anfragen ohnehin von uns. Unsere Leads gehen exklusiv an Sie.\n\nVielen Dank";
    expect(dropThirdPartyClaim(mixed)).toBe("Sehr geehrter Herr Wiebe,\n\nIhre Notrufzentrale ist rund um die Uhr besetzt. Unsere Leads gehen exklusiv an Sie.\n\nVielen Dank");
    expect(dropThirdPartyClaim(individual)).toBe(individual);
    expect(fitsApproach("drittanbieter", thirdParty)).toBe(true); expect(fitsApproach("drittanbieter", individual)).toBe(true);
  });
  it("persönlich heißt persönlich: ein Text, der die Vorlage nur mit anderem Namen wiederholt, zählt nicht als KI-Text", () => {
    const template = "Sehr geehrte Damen und Herren,\n\nwir von Tanesco Digital gehören zu den größten Lead-Lieferanten in Deutschland für Hausnotruf. Unsere Anfragen gehen exklusiv und in Echtzeit an Sie, damit Ihr Vertrieb ohne Umwege mit den Interessenten sprechen kann.\n\n20 Test-Leads kostenlos – individuell für Ihren Betrieb.\n\nVielen Dank";
    const copied = "Sehr geehrter Herr Wiebe,\n\nwir von Tanesco Digital gehören zu den größten Lead-Lieferanten in Deutschland für Hausnotruf. Unsere Anfragen gehen exklusiv und in Echtzeit an Sie, damit Ihr Vertrieb ohne Umwege mit den Interessenten sprechen kann.\n\n20 Test-Leads kostenlos – individuell für Ihren Betrieb.\n\nVielen Dank";
    const own = "Sehr geehrter Herr Wiebe,\n\nauf Ihrer Webseite schreiben Sie, dass der Notrufknopf bei Ihnen schon am Tag nach der Bestellung installiert ist. Genau diese Geschwindigkeit erwarten auch die Senioren, die sich bei uns melden – meist die Kinder, die für ihre Eltern in Kassel und Umgebung eine Lösung suchen.\n\nZum Kennenlernen bekommen Sie 20 Test-Leads kostenlos.\n\nVielen Dank";
    expect(copiesTemplate(copied, template)).toBe(true);
    expect(copiesTemplate(own, template)).toBe(false);
    expect(copiesTemplate("Sehr geehrter Herr Wiebe,\n\n20 Test-Leads kostenlos – individuell für Ihren Betrieb.\n\nVielen Dank", template)).toBe(false); // nur Pflichtinhalte: zu kurz zum Prüfen
  });
  it("Auto-Modus: Entwurf im richtigen Ansatz geht raus; im falschen wird der passende Vorschlag genommen oder neu geschrieben", () => {
    const base = { draftSubject: "Direkte Zusammenarbeit", draftText: thirdParty, draftState: "entwurf", draftSource: "ki", draftOptions: options };
    expect(autoDraftFor({ ...base, draftApproach: "drittanbieter" }, "drittanbieter")?.text).toBe(thirdParty);
    expect(autoDraftFor({ ...base, draftApproach: "drittanbieter" }, "frei")).toMatchObject({ approach: "frei", subject: "Ihr Versprechen ohne Anzahlung" }); // Vorschlag aus den Alternativen
    expect(autoDraftFor({ ...base, draftApproach: "drittanbieter", draftOptions: [] }, "frei")).toBeNull(); // nichts Passendes → KI schreibt neu
    expect(autoDraftFor({ ...base, draftApproach: "drittanbieter", draftState: "freigegeben" }, "frei")?.text).toBe(thirdParty); // von dir freigegeben → bleibt
    expect(autoDraftFor({ ...base, draftApproach: "drittanbieter", draftSource: "hand" }, "frei")?.text).toBe(thirdParty); // selbst geschrieben → bleibt
    expect(autoDraftFor({ ...base, draftApproach: null }, "frei")?.text).toBe(thirdParty); // alter Entwurf ohne Angabe
    expect(autoDraftFor({ ...base, draftApproach: "frei", draftState: null }, "frei")).toBeNull(); // kein Entwurf
    // alter Entwurf im individuellen Ansatz geht nie raus: der Vorschlag im Ansatz der Kampagne – oder neu schreiben
    expect(autoDraftFor({ ...base, draftApproach: "individuell", draftText: individual, draftOptions: [{ key: "individuell", label: "Individueller Ansatz", subject: "Alt", text: `${individual} Mehr Text, damit es lang genug ist.` }] }, "frei")).toBeNull();
    expect(autoDraftFor({ ...base, draftApproach: "individuell", draftText: individual }, "frei")).toMatchObject({ approach: "frei", subject: "Ihr Versprechen ohne Anzahlung" });
  });
});
