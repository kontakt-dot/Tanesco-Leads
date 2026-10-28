import { describe, expect, it } from "vitest";
import { autoDraftFor, fitsApproach } from "../shared/email-campaigns";

const individual = "Sehr geehrter Herr Wiebe,\n\nauf Ihrer Website steht „Keine Anzahlung, 0 % Risiko“. Genau so arbeiten wir auch.";
const thirdParty = "Sehr geehrter Herr Wiebe,\n\nsehr wahrscheinlich kommen bei Ihnen Leads an, die ohnehin von uns stammen – nur über Zwischenhändler weitergereicht.";
const options = [{ key: "individuell", label: "Individueller Ansatz", subject: "Ihr Versprechen ohne Anzahlung", text: `${individual} Mehr Text, damit es lang genug ist.` }, { key: "drittanbieter", label: "Drittanbieter-Ansatz", subject: "Direkte Zusammenarbeit", text: `${thirdParty} Mehr Text, damit es lang genug ist.` }];

describe("KI-Ansatz: es geht nur der gewählte Ansatz raus", () => {
  it("individueller/freier Vorschlag ohne Drittanbieter-Kernbotschaft – Drittanbieter wird nicht beschnitten", () => {
    expect(fitsApproach("individuell", individual)).toBe(true);
    expect(fitsApproach("individuell", thirdParty)).toBe(false);
    expect(fitsApproach("frei", "Wir vermuten, Ihre Leads kommen über Umwege – über Dritte.")).toBe(false);
    expect(fitsApproach("drittanbieter", thirdParty)).toBe(true); expect(fitsApproach("drittanbieter", individual)).toBe(true);
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
