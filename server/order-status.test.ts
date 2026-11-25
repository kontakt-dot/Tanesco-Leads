import { describe, expect, it } from "vitest";
import { orderStatusChoice, orderStatusLabel } from "../shared/order-status";
import { evaluateOrderEligibility } from "./order-eligibility";

/** Version 365 – Bestellungen: nur noch Aktiv/Inaktiv („offen“ heißt Inaktiv), Leadmenge leer = unbegrenzt. */
describe("Bestellstatus und unbegrenzte Leadmenge (v365)", () => {
  it("„offen“ und „pausiert“ heißen Inaktiv – nur Aktiv bekommt Leads", () => {
    expect(["offen", "aktiv", "pausiert", "erfüllt", "storniert"].map((status) => orderStatusChoice(status))).toEqual(["pausiert", "aktiv", "pausiert", "erfüllt", "storniert"]);
    expect(["offen", "aktiv", "pausiert", "erfüllt", "storniert"].map((status) => orderStatusLabel(status))).toEqual(["Inaktiv", "Aktiv", "Inaktiv", "Erfüllt", "Storniert"]);
    expect(orderStatusLabel("aktiv", false)).toBe("Inaktiv"); // Konfiguration ausgeschaltet
  });

  it("Leadmenge 0 (leer) = keine Grenze; mit Zahl endet die Bestellung bei dieser Menge", () => {
    const config = { active: true, ongoing: true, startsAt: null, endsAt: null, deliveryDays: [], pauses: [], requestedQuantity: 0, advancedFilters: {}, supplierRestrictions: {} };
    const lead = { supplierId: null, postcode: "10115", cost: 0 };
    expect(evaluateOrderEligibility(config, lead, 5000)).toEqual({ eligible: true });
    expect(evaluateOrderEligibility({ ...config, requestedQuantity: 10 }, lead, 9)).toEqual({ eligible: true });
    expect(evaluateOrderEligibility({ ...config, requestedQuantity: 10 }, lead, 10)).toEqual({ eligible: false, reason: "Bestellmenge erreicht (10/10)" });
  });
});
