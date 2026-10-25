import { describe, expect, it } from "vitest";
import { ampelOf, warmupLimit } from "./mail-health";
import { managerFromImpressum, nameFromEmail } from "./sales-outreach";

describe("Zustellbarkeit – Bausteine", () => {
  it("Ampel: rot ohne SPF, gelb bei fehlendem DKIM/DMARC oder fremdem SPF, grün wenn alles da", () => {
    const base = { spf: { found: true, providerIncluded: true }, dkim: { found: true }, dmarc: { found: true } };
    expect(ampelOf(base)).toBe("gruen");
    expect(ampelOf({ ...base, spf: { found: false } })).toBe("rot");
    expect(ampelOf({ ...base, dmarc: { found: false } })).toBe("gelb");
    expect(ampelOf({ ...base, dkim: { found: false } })).toBe("gelb");
    expect(ampelOf({ ...base, spf: { found: true, providerIncluded: false } })).toBe("gelb");
    expect(ampelOf(null)).toBe("unbekannt");
  });
  it("Warmlaufen: Woche 1 = 40, +20 je Woche, gedeckelt auf das eingestellte Limit", () => {
    const start = new Date("2026-10-01T08:00:00Z");
    expect(warmupLimit(start, 80, new Date("2026-10-03T08:00:00Z"))).toEqual({ limit: 40, week: 1, done: false });
    expect(warmupLimit(start, 80, new Date("2026-10-09T08:00:00Z"))).toEqual({ limit: 60, week: 2, done: false });
    expect(warmupLimit(start, 80, new Date("2026-10-16T08:00:00Z"))).toEqual({ limit: 80, week: 3, done: true });
    expect(warmupLimit(start, 50, new Date("2026-10-09T08:00:00Z"))).toEqual({ limit: 50, week: 2, done: true }); // nie über das eingestellte Limit
    expect(warmupLimit(null, 80)).toEqual({ limit: 80, week: 0, done: true }); // ohne Startdatum kein Warmlaufen
  });
  it("Ansprechpartner aus der E-Mail-Adresse – nur echte Namen, nie info@ & Co.", () => {
    expect(nameFromEmail("max.mustermann@koppen-solar.de")).toEqual({ firstName: "Max", lastName: "Mustermann" });
    expect(nameFromEmail("anna-lena.meier@firma.de")).toBeNull(); // Bindestrich im ersten Teil passt nicht aufs Muster – lieber nichts raten
    expect(nameFromEmail("j.schneider@firma.de")).toBeNull(); // nur ein Buchstabe vorn – zu unsicher
    expect(nameFromEmail("info@koppen-solar.de")).toBeNull();
    expect(nameFromEmail("vertrieb.sued@firma.de")).toBeNull();
    expect(nameFromEmail(null)).toBeNull();
  });
  it("Geschäftsführer aus dem Impressum – übliche Formulierungen, ohne Titel", () => {
    expect(managerFromImpressum("Impressum\nKoppen Solar GmbH\nGeschäftsführer: Stefan Koppen\nHRB 12345")).toEqual({ firstName: "Stefan", lastName: "Koppen" });
    expect(managerFromImpressum("Vertreten durch Maria Anna Huber")).toEqual({ firstName: "Maria Anna", lastName: "Huber" });
    expect(managerFromImpressum("Inhaberin: Dr. Petra Vogel")).toEqual({ firstName: "Petra", lastName: "Vogel" });
    expect(managerFromImpressum("Hier steht kein Name")).toBeNull();
  });
});
