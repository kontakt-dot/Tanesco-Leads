import { describe, expect, it } from "vitest";
import { CALL_MORE_PERIODS, CALL_OPEN_MODES, CALL_PERIOD_KEYS, CALL_QUICK_PERIODS, callPeriodRange, callPeriodSpan, callSpanTexts, isSingleDaySpan, monthStart, spanHasToday, spanLength, weekStart } from "../shared/call-period";
import { callRangeInput, hasCallRange, periodPhrase, rangeOfSpan } from "../shared/call-overview";
import { detectTopic } from "../shared/call-topic";

describe("Zeitraum-Filter für Gespräche", () => {
  const now = new Date("2026-11-11T13:30:00Z"); // 14:30 deutscher Zeit
  it("heute = ab Mitternacht deutscher Zeit, ohne Ende", () => { const range = callPeriodRange({ period: "heute" }, now); expect(range.from?.toISOString()).toBe("2026-11-10T23:00:00.000Z"); expect(range.to).toBeNull(); });
  it("gestern = ein voller Tag", () => { const range = callPeriodRange({ period: "gestern" }, now); expect(range.from?.toISOString()).toBe("2026-11-09T23:00:00.000Z"); expect(range.to?.toISOString()).toBe("2026-11-10T23:00:00.000Z"); });
  it("7 und 30 Tage zählen den heutigen Tag mit", () => { expect(callPeriodRange({ period: "7" }, now).from?.toISOString()).toBe("2026-11-04T23:00:00.000Z"); expect(callPeriodRange({ period: "30" }, now).from?.toISOString()).toBe("2026-10-12T22:00:00.000Z"); }); // der 13.10. liegt noch in der Sommerzeit – der Zeitraum beginnt trotzdem um Mitternacht
  it("gesamt / leer = kein Filter", () => { expect(callPeriodRange({ period: "alle" }, now)).toEqual({ from: null, to: null }); expect(callPeriodRange(undefined, now)).toEqual({ from: null, to: null }); });
  it("von/bis gilt einschließlich des Bis-Tags und schlägt die Kurzwahl", () => { const range = callPeriodRange({ period: "heute", from: "2026-11-01", to: "2026-11-03" }, now); expect(range.from?.toISOString()).toBe("2026-10-31T23:00:00.000Z"); expect(range.to?.toISOString()).toBe("2026-11-03T23:00:00.000Z"); });
  it("Sommerzeit wird berücksichtigt", () => { expect(callPeriodRange({ from: "2026-07-01" }, now).from?.toISOString()).toBe("2026-06-30T22:00:00.000Z"); });
  it("kaputte Datumsangaben werden ignoriert", () => { expect(callPeriodRange({ from: "01.11.2026", to: "x" }, now)).toEqual({ from: null, to: null }); });
});

/** Weitere Zeiträume wie auf der Leads-Seite: diese Woche, letzte Woche, letzte 2 Wochen, dieser Monat, letzter Monat – dazu zwischen, ab, vor. */
describe("Zeitraum-Filter für Gespräche – weitere Zeiträume (v378)", () => {
  const now = new Date("2026-11-11T13:30:00Z"); const today = "2026-11-11"; // Mittwoch, 14:30 deutscher Zeit
  const iso = (value: Date | null) => value?.toISOString() ?? null;
  it("Auswahl: fünf schnelle Knöpfe, fünf feste Zeiträume in der Liste, drei eigene – jede Kurzwahl ist dem Server bekannt", () => {
    expect(CALL_QUICK_PERIODS.map(([, label]) => label)).toEqual(["Heute", "Gestern", "7 Tage", "30 Tage", "Gesamt"]);
    expect(CALL_MORE_PERIODS.map(([, label]) => label)).toEqual(["Diese Woche", "Letzte Woche", "Letzte 2 Wochen", "Dieser Monat", "Letzter Monat"]);
    expect(CALL_OPEN_MODES.map(([, label]) => label)).toEqual(["Zwischen …", "Ab …", "Vor …"]);
    for (const [key] of [...CALL_QUICK_PERIODS, ...CALL_MORE_PERIODS]) expect(CALL_PERIOD_KEYS, key).toContain(key);
  });
  it("Wochen beginnen am Montag, Monate am Ersten – auch über Monats- und Jahresgrenzen", () => {
    expect(weekStart("2026-11-11")).toBe("2026-11-09"); expect(weekStart("2026-11-09")).toBe("2026-11-09"); expect(weekStart("2026-11-15")).toBe("2026-11-09"); expect(weekStart("2027-01-01")).toBe("2026-12-28");
    expect(monthStart("2026-11-11")).toBe("2026-11-01"); expect(monthStart("2026-01-15", -1)).toBe("2025-12-01"); expect(monthStart("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("„Diese Woche“ läuft ab Montag bis jetzt, „Dieser Monat“ ab dem Ersten", () => {
    expect(callPeriodSpan({ period: "woche" }, today)).toEqual({ kind: "woche", fromDay: "2026-11-09", toDay: null });
    const week = callPeriodRange({ period: "woche" }, now); expect(iso(week.from)).toBe("2026-11-08T23:00:00.000Z"); expect(week.to).toBeNull();
    expect(callPeriodSpan({ period: "monat" }, today)).toEqual({ kind: "monat", fromDay: "2026-11-01", toDay: null });
    const month = callPeriodRange({ period: "monat" }, now); expect(iso(month.from)).toBe("2026-10-31T23:00:00.000Z"); expect(month.to).toBeNull();
  });
  it("„Letzte Woche“ und „Letzte 2 Wochen“ sind volle Wochen bis zum letzten Sonntag", () => {
    expect(callPeriodSpan({ period: "letzte_woche" }, today)).toEqual({ kind: "letzte_woche", fromDay: "2026-11-02", toDay: "2026-11-08" });
    const one = callPeriodRange({ period: "letzte_woche" }, now); expect(iso(one.from)).toBe("2026-11-01T23:00:00.000Z"); expect(iso(one.to)).toBe("2026-11-08T23:00:00.000Z");
    expect(callPeriodSpan({ period: "letzte_2_wochen" }, today)).toEqual({ kind: "letzte_2_wochen", fromDay: "2026-10-26", toDay: "2026-11-08" });
    const two = callPeriodRange({ period: "letzte_2_wochen" }, now); expect(iso(two.from)).toBe("2026-10-25T23:00:00.000Z"); expect(iso(two.to)).toBe("2026-11-08T23:00:00.000Z");
    expect(callPeriodSpan({ period: "letzte_woche" }, "2026-11-09")).toMatchObject({ fromDay: "2026-11-02", toDay: "2026-11-08" }); // am Montag: die Woche bis gestern
  });
  it("„Letzter Monat“ ist der ganze Vormonat – Sommer- und Winterzeit stimmen an beiden Enden", () => {
    expect(callPeriodSpan({ period: "letzter_monat" }, today)).toEqual({ kind: "letzter_monat", fromDay: "2026-10-01", toDay: "2026-10-31" });
    const range = callPeriodRange({ period: "letzter_monat" }, now); expect(iso(range.from)).toBe("2026-09-30T22:00:00.000Z"); expect(iso(range.to)).toBe("2026-10-31T23:00:00.000Z");
    expect(callPeriodSpan({ period: "letzter_monat" }, "2027-01-03")).toMatchObject({ fromDay: "2026-12-01", toDay: "2026-12-31" }); expect(callPeriodSpan({ period: "letzter_monat" }, "2026-03-31")).toMatchObject({ fromDay: "2026-02-01", toDay: "2026-02-28" });
  });
  it("eigener Zeitraum: zwischen zwei Tagen, ab einem Tag, vor einem Tag", () => {
    expect(callPeriodSpan({ from: "2026-11-01", to: "2026-11-05" }, today)).toEqual({ kind: "zwischen", fromDay: "2026-11-01", toDay: "2026-11-05" });
    expect(callPeriodSpan({ from: "2026-11-01" }, today)).toEqual({ kind: "ab", fromDay: "2026-11-01", toDay: null });
    expect(callPeriodSpan({ to: "2026-11-05" }, today)).toEqual({ kind: "vor", fromDay: null, toDay: "2026-11-05" });
    const before = callPeriodRange({ to: "2026-11-05" }, now); expect(before.from).toBeNull(); expect(iso(before.to)).toBe("2026-11-05T23:00:00.000Z"); // bis einschließlich 5. = vor dem 6.
    expect(callPeriodSpan({ period: "woche", from: "x" }, today)).toEqual({ kind: "alle", fromDay: null, toDay: null }); expect(callPeriodSpan(undefined, today).kind).toBe("alle");
  });
  it("ein einzelner Tag, „heute dabei“ und die Länge des Zeitraums", () => {
    const span = (input: Parameters<typeof callPeriodSpan>[0]) => callPeriodSpan(input, today);
    expect(isSingleDaySpan(span({ period: "heute" }), today)).toBe(true); expect(isSingleDaySpan(span({ period: "gestern" }), today)).toBe(true); expect(isSingleDaySpan(span({ from: "2026-11-03", to: "2026-11-03" }), today)).toBe(true); expect(isSingleDaySpan(span({ from: today }), today)).toBe(true);
    expect(isSingleDaySpan(callPeriodSpan({ period: "woche" }, "2026-11-09"), "2026-11-09")).toBe(false); expect(isSingleDaySpan(span({ period: "7" }), today)).toBe(false); expect(isSingleDaySpan(span({ period: "alle" }), today)).toBe(false);
    expect(spanHasToday(span({ period: "woche" }), today)).toBe(true); expect(spanHasToday(span({ period: "letzte_woche" }), today)).toBe(false); expect(spanHasToday(span({ period: "gestern" }), today)).toBe(false); expect(spanHasToday(span({ period: "alle" }), today)).toBe(true); expect(spanHasToday(span({ to: "2026-11-10" }), today)).toBe(false); expect(spanHasToday(span({ from: "2026-11-12" }), today)).toBe(false);
    expect(spanLength(span({ period: "woche" }), today)).toBe(3); expect(spanLength(span({ period: "letzte_2_wochen" }), today)).toBe(14); expect(spanLength(span({ from: "2026-11-01", to: "2026-12-31" }), today)).toBe(11); expect(spanLength(span({ period: "alle" }), today)).toBeNull();
  });
  it("die Worte zum Zeitraum: Überschrift, im Satz und womit verglichen wird", () => {
    const texts = (input: Parameters<typeof callPeriodSpan>[0]) => callSpanTexts(callPeriodSpan(input, today), today);
    expect(texts({ period: "heute" })).toEqual({ label: "Heute", inText: "heute", before: "am letzten Tag mit Gesprächen", versus: "", single: true });
    expect(texts({ period: "30" })).toEqual({ label: "30 Tage", inText: "in 30 Tagen", before: "in den 30 Tagen davor", versus: "zu den 30 Tagen davor", single: false });
    expect(texts({ period: "woche" })).toMatchObject({ label: "Diese Woche", inText: "diese Woche", versus: "zur letzten Woche", single: false }); expect(texts({ period: "letzte_woche" })).toMatchObject({ label: "Letzte Woche", inText: "letzte Woche", before: "in der Woche davor", versus: "zur Woche davor" });
    expect(texts({ period: "letzte_2_wochen" })).toMatchObject({ label: "Letzte 2 Wochen", inText: "in den letzten 2 Wochen", versus: "zu den 2 Wochen davor" }); expect(texts({ period: "monat" })).toMatchObject({ label: "Dieser Monat", inText: "diesen Monat", versus: "zum letzten Monat" }); expect(texts({ period: "letzter_monat" })).toMatchObject({ label: "Letzter Monat", inText: "letzten Monat", versus: "zum Monat davor" });
    expect(texts({ period: "gestern" })).toMatchObject({ label: "Gestern", inText: "gestern", single: true }); expect(texts({ period: "alle" })).toEqual({ label: "Gesamt", inText: "insgesamt", before: "", versus: "", single: false });
    expect(texts({ from: "2026-11-01", to: "2026-11-05" })).toEqual({ label: "01.11.–05.11.2026", inText: "vom 01.11. bis 05.11.2026", before: "in den 5 Tagen davor", versus: "zu den 5 Tagen davor", single: false });
    expect(texts({ from: "2025-12-20", to: "2026-01-05" })).toMatchObject({ label: "20.12.2025–05.01.2026", inText: "vom 20.12.2025 bis 05.01.2026" });
    expect(texts({ from: "2026-11-03", to: "2026-11-03" })).toMatchObject({ label: "03.11.2026", inText: "am 03.11.2026", single: true });
    expect(texts({ from: "2026-11-01" })).toMatchObject({ label: "ab 01.11.2026", inText: "seit dem 01.11.2026", before: "in den 11 Tagen davor", single: false });
    expect(texts({ to: "2026-11-05" })).toEqual({ label: "vor 06.11.2026", inText: "vor dem 06.11.2026", before: "", versus: "", single: false }); // bis einschließlich 5. = vor dem 6.
  });
  it("Oberfläche: von/bis schlägt die Kurzwahl; aus einer Spanne wird wieder derselbe Zeitraum", () => {
    expect(callRangeInput({ period: "woche", from: "", to: "" })).toEqual({ period: "woche", from: null, to: null }); expect(callRangeInput({ period: "alle", from: "2026-11-01", to: "", open: "ab" })).toEqual({ period: null, from: "2026-11-01", to: null });
    expect(hasCallRange({ period: "alle", from: "", to: "" })).toBe(false); expect(hasCallRange({ period: "alle", from: "", to: "", open: "zwischen" })).toBe(false); expect(hasCallRange({ period: "letzter_monat", from: "", to: "" })).toBe(true); expect(hasCallRange({ period: "alle", from: "", to: "2026-11-05" })).toBe(true);
    expect(rangeOfSpan(callPeriodSpan({ period: "letzte_woche" }, today))).toEqual({ period: "letzte_woche", from: "", to: "" });
    expect(rangeOfSpan(callPeriodSpan({ from: "2026-11-01", to: "2026-11-05" }, today))).toEqual({ period: "alle", from: "2026-11-01", to: "2026-11-05", open: "zwischen" });
    expect(rangeOfSpan(callPeriodSpan({ to: "2026-11-05" }, today))).toEqual({ period: "alle", from: "", to: "2026-11-05", open: "vor" });
    for (const [key] of CALL_MORE_PERIODS) expect(callRangeInput(rangeOfSpan(callPeriodSpan({ period: key }, today))), key).toEqual({ period: key, from: null, to: null });
    expect(periodPhrase({ period: "woche", from: "", to: "" })).toBe("diese Woche"); expect(periodPhrase({ period: "letzter_monat", from: "", to: "" })).toBe("letzten Monat");
  });
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
