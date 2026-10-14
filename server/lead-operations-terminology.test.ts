import { describe, expect, it } from "vitest";
import { normalizeLeadOperationsTerminology } from "../client/src/lib/leadOpsTerminology";

describe("sichtbare Lead-Operations-Terminologie", () => {
  it("ersetzt Mandantenformulierungen mit grammatikalisch passenden Organisationsbegriffen", () => {
    const text = "Aus dem Mandantenkontext für den aktiven Mandanten stammen mandantenbezogene Mandantendaten.";
    expect(normalizeLeadOperationsTerminology(text)).toBe("Aus dem Lead-Operations-Kontext für Ihren aktiven Lead-Bereich stammen organisationsbezogene Organisationsdaten.");
  });
});
