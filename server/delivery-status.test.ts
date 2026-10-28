import { describe, expect, it } from "vitest";
import { deliveryStatusOf } from "./mail-events";
import { deliveryCounts } from "../shared/sent-tracking";

describe("Zustellung: kam die E-Mail wirklich an?", () => {
  it("Brevo-Meldungen (Abfrage und Webhook) → Zustand", () => {
    expect(["delivered", "deferred", "softBounces", "soft_bounce", "hardBounces", "hard_bounce", "invalid", "invalid_email", "blocked", "spam", "error"].map(deliveryStatusOf)).toEqual(["zugestellt", "verzoegert", "verzoegert", "verzoegert", "unzustellbar", "unzustellbar", "unzustellbar", "unzustellbar", "blockiert", "spam", "fehler"]);
    expect(deliveryStatusOf("opened")).toBeNull(); expect(deliveryStatusOf("click")).toBeNull(); expect(deliveryStatusOf("request")).toBeNull(); // kein Zustellungs-Ereignis
  });
  it("je Kampagne zusammengezählt – ohne Rückmeldung zählt als offen", () => {
    expect(deliveryCounts([{ delivery: "zugestellt", count: 40 }, { delivery: "unzustellbar", count: 2 }, { delivery: "blockiert", count: 1 }, { delivery: "verzoegert", count: 3 }, { delivery: null, count: 4 }]))
      .toEqual({ total: 50, zugestellt: 40, verzoegert: 3, unzustellbar: 2, blockiert: 1, spam: 0, fehler: 0, offen: 4, probleme: 3 });
    expect(deliveryCounts([])).toMatchObject({ total: 0, offen: 0, probleme: 0 });
  });
});
