import { describe, expect, it } from "vitest";
import { barHeight, clockLayout, clockText, dayLabel, decisionOf, groupTimeline, moodOf, periodPhrase, singleDayOf, summarizeCalls, talkTimeText, TIMELINE_LIMIT, type OverviewRow, type TimelineEntry } from "../shared/call-overview";

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 18, 8, 0) + minutes * 60_000);
const row = (id: number, values: Partial<OverviewRow> = {}): OverviewRow => ({ id, status: "bewertet", decision: "freigegeben", verdict: "verkaufbar", score: 80, agentName: "Anna Agent", startedAt: at(id), durationSeconds: 120, ...values });

describe("Anzeigetafel der Gespräche", () => {
  it("Ampel eines Gesprächs: Entscheidung zählt zuerst, sonst das Urteil, sonst die Note", () => {
    expect(moodOf({ decision: "freigegeben", verdict: "nicht_verkaufbar" })).toBe("gruen"); expect(moodOf({ decision: "pruefen" })).toBe("gelb"); expect(moodOf({ decision: "zurueckgewiesen" })).toBe("rot");
    expect(decisionOf(null)).toBe("offen"); expect(decisionOf("irgendwas")).toBe("offen"); expect(decisionOf("pruefen")).toBe("pruefen");
    expect(moodOf({ decision: "offen", verdict: "nachfassen" })).toBe("gelb"); expect(moodOf({ decision: "offen", status: "bewertet", score: 75 })).toBe("gruen"); expect(moodOf({ decision: "offen", status: "eingegangen" })).toBe("offen");
  });
  it("zählt je Ampel-Farbe, Quote nur über entschiedene Gespräche, Gesprächszeit und Schnitt", () => {
    const rows = [row(1), row(2, { decision: "pruefen", verdict: "nachfassen", score: 55, durationSeconds: 60 }), row(3, { decision: "zurueckgewiesen", verdict: "nicht_verkaufbar", score: 10, durationSeconds: 30 }), row(4, { decision: "offen", verdict: null, status: "transkribiert", score: null, durationSeconds: null }), row(5, { decision: "offen", verdict: null, status: "ohne_einwilligung", score: null }), row(6, { decision: "offen", verdict: null, status: "fehlgeschlagen", score: null, durationSeconds: 0 })];
    const overview = summarizeCalls(rows);
    expect(overview).toMatchObject({ total: 6, evaluated: 3, approved: 1, review: 1, rejected: 1, open: 3, noConsent: 1, failed: 1, approvalRate: 33, talkSeconds: 330, averageSeconds: 83, averageScore: 48 });
    expect(overview.timeline.map((entry) => [entry.id, entry.mood])).toEqual([[1, "gruen"], [2, "gelb"], [3, "rot"], [4, "offen"], [5, "offen"], [6, "offen"]]);
    expect(overview.timeline[0]).toEqual({ id: 1, at: at(1).toISOString(), seconds: 120, mood: "gruen", decision: "freigegeben", agent: "Anna Agent" });
    expect(overview.timeline.map((entry) => entry.decision)).toEqual(["freigegeben", "pruefen", "zurueckgewiesen", "offen", "offen", "offen"]); // danach filtern die Zähler der Anzeigetafel
  });
  it("ohne Gespräche: alles 0, keine Quote, kein Schnitt", () => {
    expect(summarizeCalls([])).toEqual({ total: 0, evaluated: 0, approved: 0, review: 0, rejected: 0, open: 0, noConsent: 0, failed: 0, averageScore: null, approvalRate: null, talkSeconds: 0, averageSeconds: null, timeline: [], timelineHidden: 0, byAgent: [] });
  });
  it("Gespräche ohne Kriterien-Punkte ziehen die Durchschnittsnote nicht auf 0", () => {
    expect(summarizeCalls([row(1, { score: 90 }), row(2, { score: 0, unscored: true }), row(3, { score: 0 })]).averageScore).toBe(45);
  });
  it("Agent-Filter gilt für Zahlen und Verlauf – die Agenten-Leiste zeigt weiter alle, die meisten Gespräche zuerst", () => {
    const rows = [row(1), row(2), row(3, { decision: "pruefen" }), row(4, { agentName: "Bert Berater", decision: "zurueckgewiesen", durationSeconds: 300 }), row(5, { agentName: "Bert Berater" }), row(6, { agentName: null }), row(7, { agentName: "  " })];
    const all = summarizeCalls(rows); const bert = summarizeCalls(rows, { agentName: "Bert Berater" });
    expect(all.total).toBe(7); expect(bert).toMatchObject({ total: 2, approved: 1, rejected: 1, review: 0, approvalRate: 50, talkSeconds: 420 }); expect(bert.timeline.map((entry) => entry.id)).toEqual([4, 5]);
    expect(bert.byAgent).toEqual(all.byAgent);
    expect(all.byAgent).toEqual([{ name: "Anna Agent", total: 3, approved: 2, review: 1, rejected: 0, open: 0, talkSeconds: 360 }, { name: "Bert Berater", total: 2, approved: 1, review: 0, rejected: 1, open: 0, talkSeconds: 420 }]); // ohne Namen zählt bei den Agenten nicht mit
  });
  it("Verlauf: zeitlich sortiert (ältestes zuerst), bei sehr vielen Gesprächen nur die jüngsten", () => {
    const shuffled = [row(3), row(1), row(2), row(9, { startedAt: null })];
    expect(summarizeCalls(shuffled).timeline.map((entry) => entry.id)).toEqual([9, 1, 2, 3]); // ohne Zeit ganz vorn
    const many = Array.from({ length: TIMELINE_LIMIT + 25 }, (_, index) => row(index + 1));
    const overview = summarizeCalls(many); expect(overview.timeline).toHaveLength(TIMELINE_LIMIT); expect(overview.timelineHidden).toBe(25); expect(overview.timeline[0].id).toBe(26); expect(overview.timeline[TIMELINE_LIMIT - 1].id).toBe(TIMELINE_LIMIT + 25); expect(overview.total).toBe(TIMELINE_LIMIT + 25);
  });
  it("Texte für Zeit und Dauer, Balkenhöhe", () => {
    expect(talkTimeText(40)).toBe("40 Sek"); expect(talkTimeText(185)).toBe("3 Min"); expect(talkTimeText(4320)).toBe("1 Std 12 Min"); expect(talkTimeText(7200)).toBe("2 Std"); expect(talkTimeText(7190)).toBe("2 Std"); expect(talkTimeText(null)).toBe("0 Sek");
    expect(clockText(133)).toBe("2:13"); expect(clockText(5)).toBe("0:05"); expect(clockText(null)).toBe("–"); expect(clockText(0)).toBe("0:00");
    expect(barHeight(600, 600)).toBe(1); expect(barHeight(null, 600)).toBe(0.16); expect(barHeight(0, 600)).toBe(0.16); expect(barHeight(150, 600)).toBeCloseTo(0.58, 2); expect(barHeight(9999, 600)).toBe(1); expect(barHeight(30, 0)).toBe(0.16);
  });
});

// Verlauf auf der Anzeigetafel: Beschriftung und Anordnung – alles in der Ortszeit des Betrachters
const local = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute);
const entry = (id: number, date: Date | null, seconds: number | null = 120): TimelineEntry => ({ id, at: date ? date.toISOString() : null, seconds, mood: "gruen", decision: "freigegeben", agent: "Anna Agent" });
const now = local(18, 15, 0);

describe("Verlauf der Anzeigetafel", () => {
  it("Zeitraum in Worten für die Überschrift", () => {
    expect(periodPhrase({ period: "heute", from: "", to: "" })).toBe("heute"); expect(periodPhrase({ period: "gestern", from: "", to: "" })).toBe("gestern");
    expect(periodPhrase({ period: "7", from: "", to: "" })).toBe("in den letzten 7 Tagen"); expect(periodPhrase({ period: "30", from: "", to: "" })).toBe("in den letzten 30 Tagen"); expect(periodPhrase({ period: "alle", from: "", to: "" })).toBe("insgesamt");
    expect(periodPhrase({ period: "alle", from: "2026-11-01", to: "2026-11-18" })).toBe("vom 01.11.2026 bis 18.11.2026"); expect(periodPhrase({ period: "alle", from: "2026-11-05", to: "2026-11-05" })).toBe("am 05.11.2026");
    expect(periodPhrase({ period: "heute", from: "2026-11-01", to: "" })).toBe("seit dem 01.11.2026"); expect(periodPhrase({ period: "heute", from: "", to: "2026-11-18" })).toBe("bis zum 18.11.2026");
  });
  it("Tage heißen Heute, Gestern oder mit Wochentag und Datum", () => {
    expect(dayLabel(local(18, 9), now)).toBe("Heute"); expect(dayLabel(local(17, 23, 59), now)).toBe("Gestern"); expect(dayLabel(local(16, 12), now)).toBe("Mo 16.11."); expect(dayLabel(local(1, 12), now)).toBe("So 01.11.");
  });
  it("ein einzelner Tag als Zeitraum: Heute, Gestern oder von = bis", () => {
    expect(singleDayOf({ period: "heute", from: "", to: "" }, now)).toEqual(local(18, 0)); expect(singleDayOf({ period: "gestern", from: "", to: "" }, now)).toEqual(local(17, 0));
    expect(singleDayOf({ period: "alle", from: "2026-11-05", to: "2026-11-05" }, now)).toEqual(local(5, 0));
    expect(singleDayOf({ period: "7", from: "", to: "" }, now)).toBeNull(); expect(singleDayOf({ period: "alle", from: "", to: "" }, now)).toBeNull(); expect(singleDayOf({ period: "heute", from: "2026-11-05", to: "2026-11-06" }, now)).toBeNull(); expect(singleDayOf({ period: "heute", from: "2026-11-05", to: "" }, now)).toBeNull();
  });
  it("mehrere Tage: ein Abschnitt je Tag – Heute und Gestern beim Namen, sonst das Datum", () => {
    const result = groupTimeline([entry(1, local(16, 9)), entry(2, local(16, 15)), entry(3, local(17, 10)), entry(4, local(18, 9)), entry(5, local(18, 14))], now);
    expect(result.byHour).toBe(false); expect(result.groups.map((group) => [group.label, group.short, group.entries.length])).toEqual([["16.11.", "16.", 2], ["Gestern", "17.", 1], ["Heute", "18.", 2]]);
  });
  it("ein Tag: ein Abschnitt je Stunde; Gespräche ohne Uhrzeit stehen für sich", () => {
    const result = groupTimeline([entry(9, null), entry(1, local(18, 9, 5)), entry(2, local(18, 9, 40)), entry(3, local(18, 11, 10))], now);
    expect(result.byHour).toBe(true); expect(result.groups.map((group) => [group.label, group.short, group.entries.map((item) => item.id)])).toEqual([["ohne Uhrzeit", "", [9]], ["9 Uhr", "9", [1, 2]], ["11 Uhr", "11", [3]]]);
    expect(groupTimeline([], now)).toEqual({ groups: [], byHour: true });
  });
  it("Uhrzeit-Achse: 8 bis 18 Uhr, jedes Gespräch an seiner Stelle, „jetzt“ nur am heutigen Tag", () => {
    const layout = clockLayout([entry(2, local(18, 13, 30)), entry(1, local(18, 9, 0)), entry(3, null)], local(18, 0), now);
    expect(layout).toMatchObject({ start: 8, end: 18, nowX: 70, untimed: 1 });
    expect(layout.bars.map((bar) => [bar.entry.id, bar.x])).toEqual([[1, 100], [2, 550]]); // nach Uhrzeit sortiert; 9:00 = 10 %, 13:30 = 55 % der Achse
    expect(layout.ticks.map((tick) => tick.hour)).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]); expect(layout.ticks.filter((tick) => tick.label).map((tick) => tick.hour)).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17]); // das Ende der Achse bleibt ohne Beschriftung
    expect(clockLayout([entry(1, local(17, 9, 0))], local(17, 0), now).nowX).toBeNull(); // gestern: keine „jetzt“-Marke
    expect(clockLayout([], local(18, 0), now)).toMatchObject({ start: 8, end: 18, bars: [], nowX: 70, untimed: 0 }); // leerer Tag: der Rahmen steht trotzdem
  });
  it("Uhrzeit-Achse wächst, wenn früher oder später telefoniert wird – auch bis „jetzt“", () => {
    const wide = clockLayout([entry(1, local(18, 6, 15)), entry(2, local(18, 19, 50), 20 * 60)], local(18, 0), now);
    expect(wide.start).toBe(6); expect(wide.end).toBe(21); // 19:50 + 20 Minuten reicht bis nach 20 Uhr
    expect(wide.ticks.filter((tick) => tick.label).map((tick) => tick.hour)).toEqual([6, 8, 10, 12, 14, 16, 18, 20]); // lange Achse: nur jede zweite Stunde beschriftet
    expect(clockLayout([], local(18, 0), local(18, 19, 30))).toMatchObject({ start: 8, end: 20 });
    expect(clockLayout([], local(18, 0), local(18, 6, 30))).toMatchObject({ start: 6, end: 18, nowX: 4.2 }); // früh am Morgen: „jetzt“ steht trotzdem auf der Achse
    expect(clockLayout([entry(1, local(18, 23, 50), 30 * 60)], local(18, 0), now).end).toBe(24); // nie über Mitternacht hinaus
  });
  it("Uhrzeit-Achse: gleichzeitige Gespräche überdecken sich nicht", () => {
    const layout = clockLayout([entry(1, local(18, 10, 0)), entry(2, local(18, 10, 0)), entry(3, local(18, 10, 1)), entry(4, local(18, 17, 30))], local(18, 0), now);
    const xs = layout.bars.map((bar) => bar.x); expect(xs[0]).toBe(200);
    for (let index = 1; index < 3; index += 1) expect(xs[index] - xs[index - 1]).toBeGreaterThanOrEqual(layout.width + 2); // jeder Strich bleibt einzeln anklickbar
    expect(xs[3]).toBe(950); expect(layout.width).toBe(10);
    const late = clockLayout([entry(1, local(18, 17, 59, )), entry(2, local(18, 17, 59)), entry(3, local(18, 17, 59))], local(18, 0), local(18, 17, 59)); expect(late.end).toBe(19); for (const bar of late.bars) expect(bar.x).toBeLessThanOrEqual(1000 - late.width); // am rechten Rand bleibt alles auf der Achse
    expect(clockLayout(Array.from({ length: 30 }, (_, index) => entry(index + 1, local(18, 9, index))), local(18, 0), now).width).toBe(7); expect(clockLayout(Array.from({ length: 50 }, (_, index) => entry(index + 1, local(18, 9, index))), local(18, 0), now).width).toBe(5);
  });
});
