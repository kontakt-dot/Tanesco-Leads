import { describe, expect, it } from "vitest";
import { websiteHref, websiteLabel, websiteLinkOf, websiteOf } from "../shared/website";

describe("Webseite eines Kontakts (Knopf „Webseite öffnen“ auf Karte und Lead-Seite)", () => {
  it("nimmt die Webseite aus der Liste – sonst die Firmen-Adresse, nie Gmail, GMX usw.", () => {
    expect(websiteOf({ felder: { Webseite: "www.koppen-solar.de" } }, "info@gmx.de")).toBe("www.koppen-solar.de");
    expect(websiteOf({ website: " https://dach-meier.de/kontakt " }, null)).toBe("https://dach-meier.de/kontakt");
    expect(websiteOf({}, "info@koppen-solar.de")).toBe("koppen-solar.de");
    expect(websiteOf({}, "max@gmail.com")).toBeNull(); expect(websiteOf(null, "frei@gmx.de")).toBeNull(); expect(websiteOf({}, null)).toBeNull();
    expect(websiteOf({ felder: { Webseite: "keine" } }, "info@firma-x.de")).toBe("firma-x.de"); // kein Domain-Text → Firmen-Adresse
  });
  it("macht daraus einen sicheren Link: https davor, nur echte Webseiten (kein javascript:, mailto:, Tippfehler)", () => {
    expect(websiteHref("koppen-solar.de")).toBe("https://koppen-solar.de/");
    expect(websiteHref("www.koppen-solar.de/team")).toBe("https://www.koppen-solar.de/team");
    expect(websiteHref("http://alt-dach.de")).toBe("http://alt-dach.de/");
    expect(websiteHref("HTTPS://Firma.DE/")).toBe("https://firma.de/");
    for (const bad of ["javascript:alert(document.cookie)", "mailto:info@firma.de", "tel:+49 30 123", "data:text/html,hi", "firma", "http//firma", "", null, "https://user:pass@firma.de", "ftp://firma.de"]) expect(websiteHref(bad as string | null)).toBeNull();
    expect(websiteLinkOf({ felder: { URL: "javascript:alert(document.cookie)" } }, "x@gmx.de")).toBeNull();
    expect(websiteLinkOf({}, "info@koppen-solar.de")).toBe("https://koppen-solar.de/");
  });
  it("zeigt im Hinweis nur den Namen der Seite", () => {
    expect(websiteLabel("https://www.koppen-solar.de/")).toBe("koppen-solar.de"); expect(websiteLabel("https://dach-meier.de/kontakt")).toBe("dach-meier.de/kontakt");
  });
});
