import { describe, expect, it } from "vitest";
import { buildClaimsCsv, filterClaims } from "../client/src/lib/claimList";

const claims = [
  { id: 1, leadId: 11, reason: "Falsche Kontaktdaten", status: "offen", dueAt: null, createdAt: new Date("2026-08-17T10:00:00.000Z") },
  { id: 2, leadId: 12, reason: "Doppelte Anfrage", status: "genehmigt", dueAt: null, createdAt: new Date("2026-08-17T11:00:00.000Z") },
];

describe("Reklamationsliste", () => {
  it("filtert nach Status und fachlichem Volltext", () => {
    expect(filterClaims(claims, "Doppelte", "alle")).toEqual([claims[1]]);
    expect(filterClaims(claims, "", "offen")).toEqual([claims[0]]);
  });

  it("exportiert nur die gefilterten Reklamationsdaten als semikolongetrenntes CSV", () => {
    expect(buildClaimsCsv([claims[1]])).toContain('"Doppelte Anfrage"');
    expect(buildClaimsCsv([claims[1]])).not.toContain("Falsche Kontaktdaten");
  });
});
