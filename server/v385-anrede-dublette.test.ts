import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { salutationFromFirstName } from "../shared/first-names";
import { isPartnerDuplicate, partnerDuplicateOf } from "../shared/partner-duplicate";

/** Version 385 – Anrede aus dem Vornamen (Wattfox verlangt sie bei Photovoltaik) und „Dublette beim Käufer“. Alle Namen sind erfunden. */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("Anrede aus dem Vornamen", () => {
  it("eindeutige Vornamen – auch türkische, polnische, russische; Doppelnamen nach dem ersten Teil", () => {
    expect(salutationFromFirstName("Wolfgang")).toBe("Herr"); expect(salutationFromFirstName("mehmet")).toBe("Herr"); expect(salutationFromFirstName(" Krzysztof ")).toBe("Herr");
    expect(salutationFromFirstName("Ayse")).toBe("Frau"); expect(salutationFromFirstName("Swetlana")).toBe("Frau"); expect(salutationFromFirstName("Hans-Peter")).toBe("Herr"); expect(salutationFromFirstName("Anna Lena")).toBe("Frau");
  });
  it("Namen für beide und Unbekanntes bleiben offen – dann fragt der Server die KI", () => {
    for (const name of ["Andrea", "Kim", "Deniz", "Xylo", "", null]) expect(salutationFromFirstName(name)).toBeNull();
    const server = read("./lead-from-call.ts");
    expect(server).toContain("export async function salutationForFirstName"); expect(server).toContain('enum: ["Herr", "Frau", "unklar"]'); expect(server).toContain("Anrede aus dem Vornamen geschlossen: ${guessedFromName}");
    expect(server).toContain("export async function salutationsFromFirstNames"); expect(read("./delivery-scheduler.ts")).toContain("salutationsFromFirstNames(db)");
  });
  it("die Anrede aus dem Gespräch geht vor – der Vorname nur, wenn sie dort nicht fiel", () => {
    const server = read("./lead-from-call.ts"); expect(server.indexOf("salutationFromTranscript(transcript, current.lastName)")).toBeLessThan(server.indexOf("guessedFromName = await salutationForFirstName"));
  });
});

describe("Dublette beim Käufer", () => {
  it("erkennt HTTP 409 und typische Antworten", () => {
    expect(isPartnerDuplicate(409, "")).toBe(true); expect(isPartnerDuplicate(400, '{"error":"Lead ist eine Dublette"}')).toBe(true); expect(isPartnerDuplicate(422, "duplicate lead")).toBe(true); expect(isPartnerDuplicate(400, "Kontakt existiert bereits")).toBe(true);
    expect(isPartnerDuplicate(400, "4034: stromverbrauch is not a valid digit")).toBe(false); expect(isPartnerDuplicate(401, "Unauthorized")).toBe(false);
  });
  it("markiert den Lead, zählt im Reiter „Dubletten“, zeigt es an der Zeile – direkt gesendet und über die Lieferkette", () => {
    expect(partnerDuplicateOf({ partnerDuplicate: { buyerName: "Beispiel GmbH", at: "x", status: 409, message: "" } })?.buyerName).toBe("Beispiel GmbH"); expect(partnerDuplicateOf({})).toBeNull();
    expect(read("./direct-delivery.ts")).toContain("Der Lead steht jetzt unter „Dubletten“."); expect(read("./lead-pipeline.ts")).toContain("isPartnerDuplicate(outcome.responseStatus");
    expect(read("./routers.ts")).toContain("if (partnerDuplicateOf(row.metadata)) duplicateIds.add(row.id)"); expect(read("../client/src/components/LeadTable.tsx")).toContain("Dublette bei {duplicate.buyerName}");
    expect(read("./delivery-scheduler.ts")).toContain("markPastPartnerDuplicates(db)");
  });
});
