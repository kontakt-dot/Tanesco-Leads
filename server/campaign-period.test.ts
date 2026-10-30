import { describe, expect, it } from "vitest";
import { campaignStatsIn, hasPeriod, inPeriod } from "../shared/sent-tracking";

const day = (offset: number, hour = 9) => new Date(2026, 9, 20 + offset, hour, 0, 0);
describe("Kampagnen-Zahlen für einen Zeitraum", () => {
  it("inPeriod: beide Grenzen zählen mit; ohne Grenzen gilt alles", () => {
    expect(hasPeriod(null)).toBe(false); expect(hasPeriod({})).toBe(false); expect(hasPeriod({ from: day(0) })).toBe(true);
    expect(inPeriod(day(1), null)).toBe(true); expect(inPeriod(null, { from: day(0) })).toBe(false);
    expect(inPeriod(day(0), { from: day(0), until: day(2) })).toBe(true); expect(inPeriod(day(2), { from: day(0), until: day(2) })).toBe(true); expect(inPeriod(day(3), { from: day(0), until: day(2) })).toBe(false); expect(inPeriod(day(-1), { from: day(0) })).toBe(false);
  });
  it("zählt die E-Mails des Zeitraums mit ihren Reaktionen – auch wenn die Reaktion nach dem Zeitraum kam; Unzustellbar/Abmeldung nach Ereignisdatum", () => {
    const events = [
      { recipientId: 1, kind: "gesendet", createdAt: day(0) }, { recipientId: 1, kind: "geoeffnet", createdAt: day(5) }, // alte Mail, spät geöffnet
      { recipientId: 1, kind: "gesendet", createdAt: day(3) }, { recipientId: 1, kind: "geklickt", createdAt: day(3, 12) }, // Mail im Zeitraum, geklickt
      { recipientId: 2, kind: "gesendet", createdAt: day(3) }, { recipientId: 2, kind: "geoeffnet", createdAt: day(9) }, // Mail im Zeitraum, erst nach dem Zeitraum geöffnet → zählt
      { recipientId: 3, kind: "gesendet", createdAt: day(1) }, { recipientId: 3, kind: "bounce", createdAt: day(4) }, // alte Mail, unzustellbar im Zeitraum
      { recipientId: 4, kind: "gesendet", createdAt: day(8) }, // nach dem Zeitraum
    ];
    const stamps = new Map([[2, { repliedAt: day(10) }]]);
    const period = { from: day(2), until: day(6, 23) };
    const stats = campaignStatsIn(events, stamps, period);
    expect(stats.mails).toEqual({ sent: 2, opened: 2, clicked: 1, replied: 1 });
    expect(stats).toMatchObject({ sent: 2, opened: 2, clicked: 1, replied: 1, bounced: 1, unsubscribed: 0, openRate: 100, clickRate: 50, bounceRate: 50 });
    const all = campaignStatsIn(events, stamps, null); expect(all.mails.sent).toBe(5); expect(all.sent).toBe(4); expect(all.opened).toBe(2); // 5 E-Mails an 4 Kontakte; geöffnet: Kontakt 1 (Öffnung + Klick) und Kontakt 2
    expect(campaignStatsIn(events, stamps, { from: day(20) })).toMatchObject({ sent: 0, mails: { sent: 0, opened: 0, clicked: 0, replied: 0 }, openRate: 0 });
  });
});
