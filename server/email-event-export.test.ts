import { describe, expect, it } from "vitest";
import { buildEmailEventsCsv } from "../client/src/lib/emailEventExport";

describe("E-Mail-Zustellverlauf-Export", () => {
  it("exportiert die statusgefilterten Zustelldaten als semikolongetrenntes CSV", () => {
    const csv = buildEmailEventsCsv([{ recipientEmail: "kontakt@example.de", subject: "Bestätigung", deliveryStatus: "zugestellt", createdAt: new Date("2026-08-17T10:00:00.000Z") }]);
    expect(csv).toContain('"kontakt@example.de";"Bestätigung";"zugestellt"');
  });
});
