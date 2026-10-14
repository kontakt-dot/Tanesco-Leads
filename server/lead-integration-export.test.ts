import { describe, expect, it, vi } from "vitest";
import { assertSafeExportUrl, buildLeadExportPayload, dispatchLeadExport } from "./lead-integration-export";

const lead = { publicId: "PV-1001", categoryId: 150001, firstName: "Anna", lastName: "Muster", email: "anna@example.de", phone: "01234", postcode: "50667", city: "Köln", country: "DE", metadata: { dachausrichtung: "Süd" } };

describe("Lead-Export an Partnerintegration", () => {
  it("versendet den strukturierten Lead per HTTPS und übernimmt Referenz sowie Rückmeldung", async () => {
    const fetchImpl = vi.fn(async () => new Response("accepted", { status: 201, headers: { "x-request-id": "OUT-4711" } }));
    const result = await dispatchLeadExport({ callbackUrl: "https://partner.example/leads", lead, fetchImpl: fetchImpl as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledWith("https://partner.example/leads", expect.objectContaining({ method: "POST", headers: expect.objectContaining({ "x-fluxora-lead-reference": "PV-1001" }) }));
    expect(result).toEqual({ eventType: "geliefert", externalReference: "OUT-4711", responseStatus: 201, responseBody: "accepted" });
    expect(buildLeadExportPayload(lead)).toMatchObject({ lead: { publicId: "PV-1001", fields: { dachausrichtung: "Süd" } } });
  });

  it("verhindert Exporte in lokale oder unverschlüsselte Netze", () => {
    expect(() => assertSafeExportUrl("http://partner.example/leads")).toThrow("HTTPS");
    expect(() => assertSafeExportUrl("https://127.0.0.1/leads")).toThrow("internes Netzwerk");
  });
});
