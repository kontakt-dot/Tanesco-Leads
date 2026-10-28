import { describe, expect, it } from "vitest";
import { deliveryStatusOf } from "./mail-events";
import { deliveryCounts, deliveryGroupOf, summarizeSent } from "../shared/sent-tracking";

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
  it("Gesendet-Liste: nach Zustellung filtern und zählen (nur Kampagnen-Mails haben eine Zustellung)", () => {
    expect(["zugestellt", "verzoegert", "unzustellbar", "blockiert", "spam", "fehler", null].map(deliveryGroupOf)).toEqual(["zugestellt", "verzoegert", "probleme", "probleme", "probleme", "probleme", "offen"]);
    const at = new Date("2026-10-28T10:00:00Z");
    const items = [
      { kind: "kampagne", campaignId: 1, at, to: "a@x.de", subject: "A", tracking: null, delivery: { status: "zugestellt" } },
      { kind: "kampagne", campaignId: 1, at, to: "b@x.de", subject: "B", tracking: null, delivery: { status: "unzustellbar" } },
      { kind: "kampagne", campaignId: 1, at, to: "c@x.de", subject: "C", tracking: null, delivery: null },
      { kind: "einzel", campaignId: null, at, to: "d@x.de", subject: "D", tracking: null, delivery: null },
    ];
    const all = summarizeSent(items, {});
    expect(all.deliveries).toEqual({ zugestellt: 1, verzoegert: 0, probleme: 1, offen: 1 });
    expect(summarizeSent(items, { delivery: "probleme" }).items.map((item) => item.to)).toEqual(["b@x.de"]);
    expect(summarizeSent(items, { delivery: "offen" }).items.map((item) => item.to)).toEqual(["c@x.de"]); // Einzel-Mails haben keine Zustellung
  });
});
