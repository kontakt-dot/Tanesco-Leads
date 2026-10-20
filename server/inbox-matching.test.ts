import { describe, expect, it } from "vitest";
import { baseSubject, domainOf, isFreemailDomain, isReplySubject, normalizeEmail } from "./inbox";

describe("Posteingang: Absender-Abgleich", () => {
  it("erkennt Antwort-Betreffe und vergleicht ohne Präfix", () => {
    expect(isReplySubject("AW: Mehr Anfragen für Koppen GmbH")).toBe(true);
    expect(isReplySubject("Re: Re: Frage")).toBe(true);
    expect(isReplySubject("WG: Angebot")).toBe(true);
    expect(isReplySubject("Antw: Termin")).toBe(true);
    expect(isReplySubject("Rechnung März")).toBe(false);
    expect(baseSubject("AW:  Re: Mehr  Anfragen für Koppen GmbH ")).toBe("mehr anfragen für koppen gmbh");
  });
  it("Domains und Freemail", () => {
    expect(domainOf("M.Koppen@Koppen.de")).toBe("koppen.de");
    expect(isFreemailDomain("gmail.com")).toBe(true);
    expect(isFreemailDomain("web.de")).toBe(true);
    expect(isFreemailDomain("koppen.de")).toBe(false);
    expect(normalizeEmail("  Info@Koppen.DE ")).toBe("info@koppen.de");
  });
});
