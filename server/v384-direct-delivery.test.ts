import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Version 384 – Leads → „Ausliefern“ → direkt an einen Kunden senden (ohne Bestellung).
 * Hier: Aufbau im Quelltext und die Schutzregeln. Den Ablauf in der Oberfläche prüft client/src/demo/__tests__/v384.test.tsx.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("Direkt an einen Kunden senden", () => {
  const server = read("./direct-delivery.ts"); const routers = read("./routers.ts"); const leadsUi = read("../client/src/components/LiveLeads.tsx");
  it("geht über die Schnittstelle des Käufers – ohne Bestellung und ohne Lieferkette", () => {
    expect(server).toContain("handOverToBuyerEndpoints(db, { tenantId, buyerUserId: buyer.userId, lead");
    expect(server).not.toMatch(/deliverLeadNow|deliveryChains/);
    expect(server).toContain('orderId: null, buyerName, unitPrice, result: "angenommen"');
  });
  it("behält die Schutzregeln: nicht doppelt, Kampagne mit eigenem Käufer, nur aktive Käufer, keine eingeschaltete Schnittstelle = Hinweis", () => {
    expect(server).toContain("Lead wurde bereits an ${previous.buyerName} ausgeliefert");
    expect(server).toContain("campaignDeliverySkip(await leadCampaignRules(db, tenantId, lead.id), buyer.userId)");
    expect(server).toContain("ist nicht aktiv");
    expect(server).toContain("keine Schnittstelle eingeschaltet");
    expect(server).toMatch(/\["neu", "genehmigt", "hängend"\]\.includes\(lead\.status\)/);
  });
  it("nimmt den Preis aus der neuesten Bestellung des Käufers mit dieser Kategorie – sonst 0,00 €", () => {
    expect(server).toContain('eq(orderOperationalConfigs.buyerUserId, buyerUserId)'); expect(server).toContain('unitPrice: "0.00", orderNumber: null');
  });
  it("nur Administratoren, höchstens 50 Leads auf einmal", () => {
    expect(routers).toMatch(/ADMIN_ONLY_MUTATIONS = new Set\(\[[^\]]*"deliverLeadsToBuyer"/);
    expect(routers).toContain("deliverLeadsToBuyer: leadopsProcedure.input(z.object({ publicIds: z.array(z.string().trim().min(4).max(16)).min(1).max(50)");
  });
  it("Leads: Bei „Ausliefern“ steht „An wen?“ – Automatisch oder ein Kunde mit Schnittstelle, mit Rückfrage vor dem Senden", () => {
    expect(leadsUi).toContain('aria-label="An wen ausliefern?"'); expect(leadsUi).toContain("Automatisch (Bestellung und Lieferkette)"); expect(leadsUi).toContain('optgroup label="Direkt an einen Kunden senden"');
    expect(leadsUi).toContain('buyer.status === "aktiv" && buyer.api'); expect(leadsUi).toContain("Er geht echt über die Schnittstelle raus – ohne Bestellung.");
  });
});
