import { describe, expect, it } from "vitest";
import { funnel, mapMetaFieldData, summarizeCampaigns } from "../shared/sales-pipeline";

describe("Vertriebspipeline (Meta Ads)", () => {
  it("fasst Kampagnen zusammen: Ausgaben, Leads je Stufe, Kosten je Lead und je Kunde", () => {
    const leads = [
      { id: 1, publicId: "A", name: "A", createdAt: new Date("2026-10-01"), pipelineStage: "kunde", adCampaignId: "c1", adCampaignName: "PV Süd", adsetName: "AG1", adName: "Ad1", adFormName: "Form PV", adPlatform: "facebook", categoryId: 1 },
      { id: 2, publicId: "B", name: "B", createdAt: new Date("2026-10-01"), pipelineStage: "termin", adCampaignId: "c1", adCampaignName: "PV Süd", adsetName: "AG1", adName: "Ad1", adFormName: "Form PV", adPlatform: "instagram", categoryId: 1 },
      { id: 3, publicId: "C", name: "C", createdAt: new Date("2026-10-02"), pipelineStage: "verloren", adCampaignId: "c1", adCampaignName: "PV Süd", adsetName: "AG2", adName: "Ad2", adFormName: "Form PV", adPlatform: "facebook", categoryId: 1 },
      { id: 4, publicId: "D", name: "D", createdAt: new Date("2026-10-02"), pipelineStage: null, adCampaignId: "c2", adCampaignName: "WP Check", adsetName: null, adName: null, adFormName: null, adPlatform: "facebook", categoryId: 2 },
    ];
    const insights = [
      { day: "2026-10-01", campaignId: "c1", campaignName: "PV Süd", adsetId: "s1", adsetName: "AG1", adId: "a1", adName: "Ad1", spend: "100.00", impressions: 5000, clicks: 100, results: 2, status: "ACTIVE", dailyBudget: "120.00" },
      { day: "2026-10-02", campaignId: "c1", campaignName: "PV Süd", adsetId: "s2", adsetName: "AG2", adId: "a2", adName: "Ad2", spend: "50.00", impressions: 2500, clicks: 25, results: 1 },
    ];
    const campaigns = summarizeCampaigns(leads, insights);
    expect(campaigns[0]).toMatchObject({ campaignId: "c1", campaignName: "PV Süd", spend: 150, impressions: 7500, clicks: 125, leads: 3, customers: 1, costPerLead: 50, costPerCustomer: 150, conversion: 33, dailyBudget: 120, status: "ACTIVE" });
    expect(campaigns[0].adsets).toEqual(["AG1", "AG2"]); expect(campaigns[0].stages).toMatchObject({ kunde: 1, termin: 1, verloren: 1 });
    expect(campaigns[1]).toMatchObject({ campaignId: "c2", leads: 1, spend: 0, costPerLead: null, costPerCustomer: null });
    const steps = funnel(leads);
    expect(steps.steps.map((step) => step.count)).toEqual([4, 2, 2, 2, 1, 1]); expect(steps.lost).toBe(1);
  });
  it("ordnet Meta-Formularfelder den Lead-Feldern zu", () => {
    const mapped = mapMetaFieldData([{ name: "email", values: ["Max@Beispiel.de"] }, { name: "phone_number", values: ["+49 160 1234567"] }, { name: "full_name", values: ["Max Muster"] }, { name: "zip_code", values: ["80331"] }, { name: "city", values: ["München"] }, { name: "hausbesitzer?", values: ["Ja"] }]);
    expect(mapped).toMatchObject({ email: "max@beispiel.de", phone: "+49 160 1234567", firstName: "Max", lastName: "Muster", postcode: "80331", city: "München" });
    expect(mapped.answers).toEqual({ "hausbesitzer?": "Ja" });
  });
});
