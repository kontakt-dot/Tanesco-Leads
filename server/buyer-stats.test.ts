import { describe, expect, it } from "vitest";
import { activityTone, lastDeliveryText, shortMoney, summarizeBuyer, type BuyerDeliveryRow } from "../shared/buyer-stats";

/** Version 389 – Zahlen im Kopf der Käufer-Seite (rein gerechnet, Server und Vorschau nutzen dieselbe Rechnung). */
const now = new Date(2026, 10, 27, 15, 0); // 27.11.2026, 15:00 Ortszeit
const at = (day: number, hour = 10) => new Date(2026, 10, day, hour, 0);
const row = (id: number, leadId: number, result: string, unitPrice: string | number | null, occurredAt: Date | string): BuyerDeliveryRow => ({ id, leadId, result, unitPrice, occurredAt });

describe("summarizeBuyer", () => {
  it("jeder bekommene Lead zählt einmal; Wert ohne reklamierte; Quote, abgelehnte, letzte Lieferung und aktive Bestellungen", () => {
    const rows = [
      row(1, 10, "angenommen", "40.00", at(26)), row(1, 10, "angenommen", "40.00", at(26)), // dieselbe Lieferung über Bestellung und Station gefunden
      row(2, 11, "reklamiert", "40.00", at(20)),
      row(3, 12, "angeboten", 25, new Date(2026, 9, 5)), // im Oktober
      row(4, 13, "abgelehnt", "0.00", at(25)),
      row(5, 10, "abgelehnt", "0.00", at(27, 9)), // später noch einmal gesendet und abgelehnt – bleibt bekommen
      row(6, 14, "abgelehnt", "0.00", at(24)), row(7, 14, "angenommen", "30.00", at(24, 12)), // erst abgelehnt, dann bekommen
      row(8, 15, "übersprungen", "50.00", at(27)), // hat ihn nie erreicht
    ];
    const orders = [{ status: "aktiv", active: true }, { status: "aktiv", active: false }, { status: "pausiert" }, { status: "erfüllt" }, { status: "offen", active: true }];
    expect(summarizeBuyer(rows, orders, now)).toEqual({ delivered: 4, thisMonth: 3, value: 95, averagePrice: 31.67, claimed: 1, claimRate: 25, rejected: 1, lastDeliveryAt: at(26).toISOString(), ordersActive: 1, ordersTotal: 5 });
  });
  it("ohne Lieferungen: alles 0 – keine Teilung durch 0, keine letzte Lieferung", () => {
    expect(summarizeBuyer([], [], now)).toEqual({ delivered: 0, thisMonth: 0, value: 0, averagePrice: 0, claimed: 0, claimRate: 0, rejected: 0, lastDeliveryAt: null, ordersActive: 0, ordersTotal: 0 });
  });
  it("Preise als Text, Zahl oder leer; unlesbare Zeiten werden übergangen; Zeit als Text geht auch", () => {
    const stats = summarizeBuyer([row(1, 1, "angenommen", null, at(3)), row(2, 2, "angenommen", "12.5", at(4).toISOString()), row(3, 3, "angenommen", "9", "kein Datum")], [], now);
    expect(stats).toMatchObject({ delivered: 2, value: 12.5, averagePrice: 6.25, lastDeliveryAt: at(4).toISOString() });
  });
  it("nur reklamierte: kein Wert, Quote 100 %", () => {
    expect(summarizeBuyer([row(1, 1, "reklamiert", "50.00", at(10))], [], now)).toMatchObject({ delivered: 1, value: 0, averagePrice: 0, claimed: 1, claimRate: 100 });
  });
});

describe("Worte und Beträge im Kopf", () => {
  it("„Letzte Lieferung“: heute/gestern mit Uhrzeit, sonst Datum und wie lange her", () => {
    expect(lastDeliveryText(null, now)).toEqual({ value: "noch keine", hint: "noch kein Lead bekommen" });
    expect(lastDeliveryText("kaputt", now)).toEqual({ value: "noch keine", hint: "noch kein Lead bekommen" });
    expect(lastDeliveryText(new Date(2026, 10, 27, 14, 5).toISOString(), now)).toEqual({ value: "heute, 14:05", hint: "zuletzt einen Lead bekommen" });
    expect(lastDeliveryText(new Date(2026, 10, 26, 9, 30).toISOString(), now)).toEqual({ value: "gestern, 09:30", hint: "zuletzt einen Lead bekommen" });
    expect(lastDeliveryText(new Date(2026, 10, 22, 18, 0).toISOString(), now)).toEqual({ value: "22.11.2026", hint: "vor 5 Tagen" });
  });
  it("Beträge kurz: ganze Euro ohne Cent, sonst mit Cent", () => {
    expect(shortMoney(11555)).toBe("11.555 €"); expect(shortMoney(35.5)).toBe("35,50 €"); expect(shortMoney(0)).toBe("0 €");
  });
  it("Punkt der Zeitleiste: Reklamation gelb, abgelehnt rot, geliefert grün, sonst grau", () => {
    expect(activityTone("Reklamation abgelehnt: Außerhalb Liefergebiet")).toBe("warn");
    expect(activityTone("API abgelehnt (HTTP 422)")).toBe("bad");
    expect(activityTone("API geliefert (HTTP 200)")).toBe("good"); expect(activityTone("Auslieferung an Vektor Klima")).toBe("good"); expect(activityTone("API anerkannt (HTTP 200)")).toBe("good");
    expect(activityTone("Lead per CSV-Import angelegt.")).toBe("info");
  });
});
