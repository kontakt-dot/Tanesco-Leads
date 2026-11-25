import { describe, expect, it } from "vitest";
import { periodComparison, periodSplit, tilePeriod } from "../shared/lead-period";
import { arrivalLabel, nameInitials } from "../shared/lead-age";
import { pageItems } from "../client/src/lib/pageItems";

/** Version 366 – Kacheln folgen dem Zeitraum, Frische der Leads in der Tabelle, Seitenknöpfe unter der Tabelle */
const NOW = new Date(2026, 10, 25, 20, 51, 0); // Mittwoch, 25.11.2026, 20:51 (Ortszeit)
const local = (date: Date | null) => (date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}` : null);

describe("Kacheln folgen dem gewählten Zeitraum (v366)", () => {
  it("ohne Zeitraum keine eigene Kachel; „Gestern“ heißt Gestern und wird mit vorgestern verglichen", () => {
    expect(tilePeriod("", "", "", NOW)).toBeNull();
    const yesterday = tilePeriod("yesterday", "2026-11-24", "2026-11-24", NOW)!;
    expect(yesterday).toMatchObject({ label: "Gestern", scope: "von gestern", versus: "vorgestern", running: false });
    expect([local(yesterday.from), local(yesterday.to), local(yesterday.previousFrom), local(yesterday.previousTo)]).toEqual(["2026-11-24 00:00", "2026-11-24 23:59", "2026-11-23 00:00", "2026-11-23 23:59"]);
  });

  it("laufende Zeiträume: bis zur selben Uhrzeit verglichen (heute, diese Woche, dieser Monat)", () => {
    const today = tilePeriod("today", "2026-11-25", "2026-11-25", NOW)!;
    expect(today).toMatchObject({ label: "Heute neu", versus: "gestern", running: true }); expect([local(today.previousFrom), local(today.previousTo)]).toEqual(["2026-11-24 00:00", "2026-11-24 20:51"]);
    const week = tilePeriod("week", "2026-11-23", "2026-11-25", NOW)!;
    expect(week).toMatchObject({ label: "Diese Woche", scope: "aus dieser Woche", versus: "letzte Woche", running: true }); expect([local(week.previousFrom), local(week.previousTo)]).toEqual(["2026-11-16 00:00", "2026-11-18 20:51"]);
    const month = tilePeriod("month", "2026-11-01", "2026-11-25", NOW)!;
    expect(month).toMatchObject({ label: "Dieser Monat", versus: "letzten Monat" }); expect([local(month.previousFrom), local(month.previousTo)]).toEqual(["2026-10-01 00:00", "2026-10-25 20:51"]);
    // am Montag ist „Diese Woche“ ein einzelner Tag – bleibt trotzdem „Diese Woche“
    expect(tilePeriod("week", "2026-11-23", "2026-11-23", new Date(2026, 10, 23, 9, 0))!.label).toBe("Diese Woche");
  });

  it("abgeschlossene Zeiträume: gleich lang davor (letzte Woche, 2 Wochen, letzter Monat)", () => {
    const lastWeek = tilePeriod("last_week", "2026-11-16", "2026-11-22", NOW)!;
    expect(lastWeek).toMatchObject({ label: "Letzte Woche", versus: "die Woche davor", running: false }); expect([local(lastWeek.previousFrom), local(lastWeek.previousTo)]).toEqual(["2026-11-09 00:00", "2026-11-15 23:59"]);
    expect(tilePeriod("last_two_weeks", "2026-11-09", "2026-11-22", NOW)).toMatchObject({ label: "Letzte 2 Wochen", versus: "die 2 Wochen davor" });
    const lastMonth = tilePeriod("last_month", "2026-10-01", "2026-10-31", NOW)!;
    expect(lastMonth).toMatchObject({ label: "Letzter Monat", scope: "aus dem letzten Monat", versus: "im Monat davor" }); expect([local(lastMonth.previousFrom), local(lastMonth.previousTo)]).toEqual(["2026-09-01 00:00", "2026-09-30 23:59"]);
  });

  it("eigene Spannen: ein Tag aus einer Säule, „zwischen“, „ab“ und „vor“", () => {
    const day = tilePeriod("custom", "2026-11-20", "2026-11-20", NOW)!;
    expect(day).toMatchObject({ label: "Fr, 20.11.", scope: "vom 20.11.", versus: "am Tag davor" }); expect(local(day.previousFrom)).toBe("2026-11-19 00:00");
    expect(tilePeriod("custom", "2026-11-24", "2026-11-24", NOW)!.label).toBe("Gestern"); // die Säule von gestern
    const between = tilePeriod("custom", "2026-11-10", "2026-11-20", NOW)!;
    expect(between).toMatchObject({ label: "10.11.–20.11.", scope: "aus dem Zeitraum", versus: "die 11 Tage davor", running: false }); expect([local(between.previousFrom), local(between.previousTo)]).toEqual(["2026-10-30 00:00", "2026-11-09 23:59"]);
    const since = tilePeriod("since", "2026-11-19", "", NOW)!;
    expect(since).toMatchObject({ label: "Ab 19.11.", scope: "seit dem 19.11.", versus: "die 7 Tage davor", running: true }); expect([local(since.previousFrom), local(since.previousTo)]).toEqual(["2026-11-12 00:00", "2026-11-18 20:51"]);
    const before = tilePeriod("before", "", "2026-11-19", NOW)!; // „Erstellt vor 20.11.“ – bis einschließlich 19.11.
    expect(before).toMatchObject({ label: "Vor 20.11.", scope: "vor dem 20.11.", versus: null, previousFrom: null, previousTo: null });
    expect(tilePeriod("custom", "2025-12-01", "2025-12-31", NOW)!.label).toBe("01.12.25–31.12.25"); // anderes Jahr: mit Jahr
    expect(tilePeriod("custom", "2026-11-20", "2026-11-10", NOW)).toBeNull(); // Ende vor dem Anfang
  });

  it("Vergleich in Worten und die Zahlen je Status", () => {
    expect(periodComparison(14, 11, "vorgestern")).toEqual({ tone: "gut", arrow: "↑", text: "3 mehr als vorgestern" });
    expect(periodComparison(9, 12, "die Woche davor")).toEqual({ tone: "ruhig", arrow: "↓", text: "3 weniger als die Woche davor" });
    expect(periodComparison(5, 5, "gestern")?.text).toBe("so viele wie gestern"); expect(periodComparison(0, 0, "gestern")?.text).toBe("wie gestern");
    expect(periodComparison(1200, 1, "im Monat davor")?.text).toBe("1.199 mehr als im Monat davor");
    expect(periodComparison(4, null, "vorgestern")).toBeNull(); expect(periodComparison(4, 2, null)).toBeNull();
    expect(periodSplit({ genehmigt: 3, zugewiesen: 6, reklamiert: 1, neu: 1 })).toEqual({ total: 11, ready: 3, delivered: 6, claimed: 1 });
    expect(periodSplit(null)).toEqual({ total: 0, ready: 0, delivered: 0, claimed: 0 });
  });
});

describe("Frische der Leads und Kürzel (v366)", () => {
  it("vor Minuten, heute, gestern, Datum – unter 15 Minuten „live“, unter einer Stunde „neu“", () => {
    const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
    expect(arrivalLabel(ago(0), NOW)).toMatchObject({ text: "gerade eben", fresh: "live" });
    expect(arrivalLabel(ago(12), NOW)).toMatchObject({ text: "vor 12 Min.", fresh: "live" });
    expect(arrivalLabel(ago(40), NOW)).toMatchObject({ text: "vor 40 Min.", fresh: "neu" });
    expect(arrivalLabel(new Date(2026, 10, 25, 17, 28), NOW)).toMatchObject({ text: "Heute 17:28", fresh: null });
    expect(arrivalLabel(new Date(2026, 10, 24, 16, 58), NOW)).toMatchObject({ text: "Gestern 16:58", fresh: null });
    expect(arrivalLabel(new Date(2026, 10, 3, 9, 5), NOW).text).toBe("03.11. 09:05");
    expect(arrivalLabel(new Date(2025, 11, 30, 9, 5), NOW).text).toBe("30.12.25");
    expect(arrivalLabel(new Date(2026, 10, 24, 16, 58), NOW).full).toBe("Dienstag, 24.11.2026 um 16:58 Uhr");
    expect(arrivalLabel(null, NOW).text).toBe("—"); expect(arrivalLabel("kein Datum", NOW).text).toBe("—");
  });

  it("Kürzel aus dem Namen – Anrede zählt nicht, ohne Namen ein Fragezeichen", () => {
    expect(nameInitials("Emma Schulz")).toBe("ES"); expect(nameInitials("Heinz-Werner Zdebel")).toBe("HZ"); expect(nameInitials("Herr Bade")).toBe("B");
    expect(nameInitials("Çağrı Öztürk")).toBe("ÇÖ"); expect(nameInitials("Name unbekannt")).toBe("?"); expect(nameInitials("")).toBe("?");
  });
});

describe("Seitenknöpfe (v366)", () => {
  it("bis 7 Seiten alle, sonst erste, letzte und Nachbarn – Lücken als null", () => {
    expect(pageItems(1, 1)).toEqual([1]); expect(pageItems(2, 4)).toEqual([1, 2, 3, 4]); expect(pageItems(1, 0)).toEqual([1]);
    expect(pageItems(1, 20)).toEqual([1, 2, 3, 4, null, 20]);
    expect(pageItems(10, 20)).toEqual([1, null, 9, 10, 11, null, 20]);
    expect(pageItems(20, 20)).toEqual([1, null, 17, 18, 19, 20]);
  });
});
