import { describe, expect, it } from "vitest";
import { autoDraftFor, copiesTemplate, fitsApproach } from "../shared/email-campaigns";

const individual = "Sehr geehrter Herr Wiebe,\n\nauf Ihrer Website steht „Keine Anzahlung, 0 % Risiko“. Genau so arbeiten wir auch.";
const thirdParty = "Sehr geehrter Herr Wiebe,\n\nsehr wahrscheinlich kommen bei Ihnen Leads an, die ohnehin von uns stammen – nur über Zwischenhändler weitergereicht.";
const options = [{ key: "individuell", label: "Individueller Ansatz", subject: "Ihr Versprechen ohne Anzahlung", text: `${individual} Mehr Text, damit es lang genug ist.` }, { key: "drittanbieter", label: "Drittanbieter-Ansatz", subject: "Direkte Zusammenarbeit", text: `${thirdParty} Mehr Text, damit es lang genug ist.` }];

describe("KI-Ansatz: es geht nur der gewählte Ansatz raus", () => {
  it("individueller/freier Vorschlag ohne Drittanbieter-Kernbotschaft – Drittanbieter wird nicht beschnitten", () => {
    expect(fitsApproach("individuell", individual)).toBe(true);
    expect(fitsApproach("individuell", thirdParty)).toBe(false);
    expect(fitsApproach("frei", "Ihre Anfragen stammen sehr wahrscheinlich von uns – nur eben über Umwege.")).toBe(false);
    expect(fitsApproach("individuell", "Unsere Leads landen über Zwischenhändler bei Ihnen.")).toBe(false);
    // allgemeiner Ärger mit Lead-Anbietern gehört zum individuellen Ansatz – das ist NICHT die Drittanbieter-Kernbotschaft (früher fälschlich verworfen → Vorlage statt KI-Text)
    expect(fitsApproach("individuell", "Viele Drittanbieter verkaufen dieselbe Anfrage an mehrere Betriebe – bei uns geht jeder Lead nur an Sie.")).toBe(true);
    expect(fitsApproach("individuell", "Wer Leads über Zwischenhändler einkauft, kennt falsche Nummern und Vorkasse.")).toBe(true);
    expect(fitsApproach("drittanbieter", thirdParty)).toBe(true); expect(fitsApproach("drittanbieter", individual)).toBe(true);
  });
  it("individuell heißt individuell: ein Text, der die Vorlage nur mit anderem Namen wiederholt, zählt nicht als KI-Text", () => {
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
    expect(autoDraftFor({ ...base, draftApproach: "drittanbieter" }, "individuell")).toMatchObject({ approach: "individuell", subject: "Ihr Versprechen ohne Anzahlung" }); // Vorschlag aus den Alternativen
    expect(autoDraftFor({ ...base, draftApproach: "drittanbieter", draftOptions: [] }, "individuell")).toBeNull(); // nichts Passendes → KI schreibt neu
    expect(autoDraftFor({ ...base, draftApproach: "drittanbieter", draftState: "freigegeben" }, "individuell")?.text).toBe(thirdParty); // von dir freigegeben → bleibt
    expect(autoDraftFor({ ...base, draftApproach: "drittanbieter", draftSource: "hand" }, "individuell")?.text).toBe(thirdParty); // selbst geschrieben → bleibt
    expect(autoDraftFor({ ...base, draftApproach: null }, "individuell")?.text).toBe(thirdParty); // alter Entwurf ohne Angabe
    expect(autoDraftFor({ ...base, draftApproach: "individuell", draftState: null }, "individuell")).toBeNull(); // kein Entwurf
  });
});
