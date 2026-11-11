import { describe, expect, it } from "vitest";
import { callPeriodRange } from "../shared/call-period";
import { detectTopic } from "../shared/call-topic";

describe("Zeitraum-Filter für Gespräche", () => {
  const now = new Date("2026-11-11T13:30:00Z"); // 14:30 deutscher Zeit
  it("heute = ab Mitternacht deutscher Zeit, ohne Ende", () => { const range = callPeriodRange({ period: "heute" }, now); expect(range.from?.toISOString()).toBe("2026-11-10T23:00:00.000Z"); expect(range.to).toBeNull(); });
  it("gestern = ein voller Tag", () => { const range = callPeriodRange({ period: "gestern" }, now); expect(range.from?.toISOString()).toBe("2026-11-09T23:00:00.000Z"); expect(range.to?.toISOString()).toBe("2026-11-10T23:00:00.000Z"); });
  it("7 und 30 Tage zählen den heutigen Tag mit", () => { expect(callPeriodRange({ period: "7" }, now).from?.toISOString()).toBe("2026-11-04T23:00:00.000Z"); expect(callPeriodRange({ period: "30" }, now).from?.toISOString()).toBe("2026-10-12T23:00:00.000Z"); });
  it("gesamt / leer = kein Filter", () => { expect(callPeriodRange({ period: "alle" }, now)).toEqual({ from: null, to: null }); expect(callPeriodRange(undefined, now)).toEqual({ from: null, to: null }); });
  it("von/bis gilt einschließlich des Bis-Tags und schlägt die Kurzwahl", () => { const range = callPeriodRange({ period: "heute", from: "2026-11-01", to: "2026-11-03" }, now); expect(range.from?.toISOString()).toBe("2026-10-31T23:00:00.000Z"); expect(range.to?.toISOString()).toBe("2026-11-03T23:00:00.000Z"); });
  it("Sommerzeit wird berücksichtigt", () => { expect(callPeriodRange({ from: "2026-07-01" }, now).from?.toISOString()).toBe("2026-06-30T22:00:00.000Z"); });
  it("kaputte Datumsangaben werden ignoriert", () => { expect(callPeriodRange({ from: "01.11.2026", to: "x" }, now)).toEqual({ from: null, to: null }); });
});

describe("Thema aus dem Transkript (Lead-Kategorie)", () => {
  it("erkennt Photovoltaik und Wärmepumpe, auch zusammen", () => {
    expect(detectTopic("Guten Tag, es geht um Ihre Anfrage zur Photovoltaikanlage.")).toBe("Photovoltaik");
    expect(detectTopic("Sie interessieren sich für eine Wärmepumpe?")).toBe("Wärmepumpe");
    expect(detectTopic("Photovoltaik und eine Wärmepumpe wären beides interessant.")).toBe("Photovoltaik & Wärmepumpe");
  });
  it("Heizung zählt nicht extra, wenn es um die Wärmepumpe geht", () => { expect(detectTopic("Ihre alte Gasheizung soll gegen eine Wärmepumpe getauscht werden.")).toBe("Wärmepumpe"); expect(detectTopic("Es geht um eine neue Heizung, eine Gasheizung.")).toBe("Heizung"); });
  it("andere Sparten und nichts Erkanntes", () => { expect(detectTopic("Wir rufen wegen des Treppenlifts an.")).toBe("Treppenlift"); expect(detectTopic("Hallo, ist dort Herr Müller?")).toBeNull(); });
});
