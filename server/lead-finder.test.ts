import { describe, expect, it } from "vitest";
import { extractProfile, sizeBucket, stripHtml } from "../shared/lead-finder";

describe("Lead-Finder: Firmenprofil aus Webseiten", () => {
  it("zieht Kontakt, Geschäftsführung, Größe, Umsatz, Einsatzgebiet und Leistungen aus Impressum und Startseite", () => {
    const home = stripHtml("<html><body><h1>Hansen Bedachungen GmbH</h1><p>Seit 1998 Ihr Dachdecker-Meisterbetrieb mit 24 Mitarbeitern. Wir sind tätig in Frankfurt, Offenbach und 50 km Umkreis. Photovoltaik und Dach aus einer Hand.</p><a href=\"/impressum\">Impressum</a><script>var x=1</script></body></html>");
    const impressum = stripHtml("<p>Hansen Bedachungen GmbH<br>Geschäftsführer: Peter Hansen<br>Telefon: 069 5550101<br>E-Mail: info@hansen-bedachungen.de<br>HRB 12345 Amtsgericht Frankfurt · USt-ID DE123456789<br>Umsatz 2025: ca. 3,2 Mio. €</p>");
    const profile = extractProfile([{ url: "https://hansen-bedachungen.de", text: home }, { url: "https://hansen-bedachungen.de/impressum", text: impressum }]);
    expect(profile.emails).toEqual(["info@hansen-bedachungen.de"]); expect(profile.phones[0]).toContain("069"); expect(profile.management).toBe("Peter Hansen");
    expect(profile.employees).toContain("24"); expect(sizeBucket(profile.employees)).toBe("Klein (10–49)"); expect(profile.revenue).toContain("3,2"); expect(profile.founded).toBe("1998");
    expect(profile.serviceArea).toContain("Frankfurt"); expect(profile.services).toEqual(expect.arrayContaining(["Photovoltaik", "Dach", "Dachdecker"])); expect(profile.registry).toBe("HRB 12345"); expect(profile.vatId).toBe("DE123456789");
  });
});
