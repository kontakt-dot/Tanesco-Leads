import { describe, expect, it } from "vitest";
import { fluxoraMasterLeadIntegrations, fluxoraStandardLeadFields, getFluxoraMasterLeadIntegration } from "../shared/leadIntegrationContracts";

describe("Fluxora-Stammintegrationen", () => {
  it("ordnet PV und Wärmepumpe den dokumentierten Kategoriecodes und Tokenvertrag zu", () => {
    expect(fluxoraMasterLeadIntegrations.PV).toMatchObject({ shortcode: "PV", leadTypeId: "PVCC", tokenHeader: "Authorization: Bearer <MANDANTEN_TOKEN>" });
    expect(fluxoraMasterLeadIntegrations.WP).toMatchObject({ shortcode: "WP", leadTypeId: "WP", tokenHeader: "Authorization: Bearer <MANDANTEN_TOKEN>" });
    expect(getFluxoraMasterLeadIntegration("pv")?.leadTypeId).toBe("PVCC");
  });

  it("enthält die standardisierten Pflichtfelder für spätere Zielintegrationen", () => {
    expect(fluxoraStandardLeadFields.find((field) => field.key === "lead_type_id")).toMatchObject({ required: true });
    expect(fluxoraStandardLeadFields.find((field) => field.key === "country_code")).toMatchObject({ required: true });
    expect(fluxoraStandardLeadFields.find((field) => field.key === "custom_data")).toBeUndefined();
  });
});
