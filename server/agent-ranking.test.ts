import { describe, expect, it } from "vitest";
import { AGENT_LEVELS, agentLevel, berlinDay, berlinOffsetMinutes, bestDayOf, compareAgents, COMPARE_MAX_DAYS, countAgentDays, countAgents, countFromDays, daysBetween, dayWindowStart, emptyBucket, finishAgentReport, hiddenAgentKeys, hideAgentIn, isNoAgent, nameKey, NO_AGENT, previousSpan, QUOTE_MIN_CALLS, readHiddenAgents, restoreAgentIn, shiftDay, streakOf, withoutHiddenAgents, type AgentBucket, type AgentDay } from "../shared/agent-ranking";
import { callPeriodSpan } from "../shared/call-period";

/** Bestenliste der Agenten: Plätze, Auf- und Abstieg, Serie, Stufe, Bestwerte – dieselbe Rechnung für Server und Vorschau. */
const bucket = (name: string, values: Partial<AgentBucket> = {}, userId: number | null = null): AgentBucket => ({ ...emptyBucket(userId, name), ...values });
const day = (name: string, date: string, calls: number, approved: number, evaluated = calls): AgentDay => ({ name, day: date, calls, approved, evaluated });
const TODAY = "2026-11-19"; // Donnerstag

describe("Bestenliste – Tage und Zeit", () => {
  it("deutscher Kalendertag: kurz vor Mitternacht deutscher Zeit ist noch derselbe Tag, danach der nächste", () => {
    expect(berlinDay(new Date("2026-11-19T22:59:00Z"))).toBe("2026-11-19"); expect(berlinDay(new Date("2026-11-19T23:00:00Z"))).toBe("2026-11-20");
    expect(berlinDay(new Date("2026-07-01T21:59:00Z"))).toBe("2026-07-01"); expect(berlinDay(new Date("2026-07-01T22:00:00Z"))).toBe("2026-07-02"); // Sommerzeit
  });
  it("Abstand zur Weltzeit: 60 Minuten im Winter, 120 im Sommer", () => { expect(berlinOffsetMinutes(new Date("2026-11-19T12:00:00Z"))).toBe(60); expect(berlinOffsetMinutes(new Date("2026-07-01T12:00:00Z"))).toBe(120); });
  it("Tage verschieben und zählen – auch über Monats- und Jahresgrenzen", () => { expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28"); expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01"); expect(daysBetween("2026-11-12", "2026-11-19")).toBe(7); expect(daysBetween("2026-11-19", "2026-11-12")).toBe(-7); });
  it("„Ohne Agent“ wird in jeder Schreibweise erkannt", () => { for (const name of [null, undefined, "", "   ", "Ohne Agent", " ohne agent "]) expect(isNoAgent(name), String(name)).toBe(true); expect(isNoAgent("Deniz Kaya")).toBe(false); });
  it("Schlüssel eines Namens: Groß-/Kleinschreibung, Akzente und Leerzeichen am Rand spielen keine Rolle – wie in der Datenbank", () => {
    expect(nameKey(" José Álvarez ")).toBe("jose alvarez"); expect(nameKey("JOSE ALVAREZ")).toBe("jose alvarez"); expect(nameKey("Çağla Öztürk")).toBe(nameKey("cagla ozturk")); expect(nameKey("İpek Şahin")).toBe(nameKey("ipek sahin"));
    expect(nameKey("Deniz Kaya")).not.toBe(nameKey("Deniz Kara")); for (const name of [null, undefined, "", "  ", "Ohne Agent"]) expect(nameKey(name), String(name)).toBe("");
  });
});

describe("Bestenliste – Stufen", () => {
  it("sieben Stufen von Neuling bis Legende – mit dem Weg zur nächsten", () => {
    expect(AGENT_LEVELS.map((level) => level.name)).toEqual(["Neuling", "Talent", "Profi", "Experte", "Meister", "Champion", "Legende"]);
    expect(agentLevel(0)).toMatchObject({ index: 0, name: "Neuling", progress: 0, next: { name: "Talent", at: 10, missing: 10 } });
    expect(agentLevel(9).name).toBe("Neuling"); expect(agentLevel(10).name).toBe("Talent"); expect(agentLevel(24).next).toEqual({ name: "Profi", at: 25, missing: 1 });
    expect(agentLevel(75)).toMatchObject({ name: "Experte", progress: 0.5, next: { name: "Meister", at: 100, missing: 25 } });
    expect(agentLevel(500)).toMatchObject({ index: 6, name: "Legende", next: null, progress: 1 }); expect(agentLevel(9999).name).toBe("Legende");
  });
  it("unbrauchbare Zahlen zählen als null", () => { for (const value of [-5, Number.NaN, Number.POSITIVE_INFINITY]) expect(agentLevel(value).name, String(value)).toBe("Neuling"); expect(agentLevel(10.9).name).toBe("Talent"); });
});

describe("Bestenliste – Serie und bester Tag", () => {
  it("Serie zählt Arbeitstage in Folge mit mindestens einem Lead – freie Tage und das Wochenende unterbrechen nicht", () => {
    const days = [day("A", "2026-11-19", 4, 1), day("A", "2026-11-18", 3, 2), day("A", "2026-11-17", 5, 1), day("A", "2026-11-16", 2, 1), /* Wochenende */ day("A", "2026-11-13", 6, 3), day("A", "2026-11-12", 4, 0), day("A", "2026-11-11", 3, 2)];
    expect(streakOf(days, TODAY)).toBe(5); // Fr, Mo, Di, Mi, Do – der Donnerstag davor (0 Leads) beendet die Serie
  });
  it("der heutige Tag unterbricht erst, wenn er ohne Lead zu Ende ist", () => {
    const days = [day("A", "2026-11-19", 3, 0), day("A", "2026-11-18", 3, 2), day("A", "2026-11-17", 5, 1)];
    expect(streakOf(days, TODAY)).toBe(2); // heute läuft noch
    expect(streakOf(days, "2026-11-20")).toBe(0); // am nächsten Tag ist der 19. ein Arbeitstag ohne Lead
  });
  it("nach mehr als einer Woche Pause ist die Serie vorbei; ohne Gespräche gibt es keine", () => {
    expect(streakOf([day("A", "2026-11-11", 3, 2), day("A", "2026-11-10", 3, 2)], TODAY)).toBe(0);
    expect(streakOf([day("A", "2026-11-12", 3, 2), day("A", "2026-11-11", 3, 2)], TODAY)).toBe(2); // genau eine Woche
    expect(streakOf([], TODAY)).toBe(0); expect(streakOf([day("A", "2026-11-19", 2, 0)], TODAY)).toBe(0);
    expect(streakOf([day("A", "2026-11-25", 2, 2), day("A", "2026-11-19", 2, 1)], TODAY)).toBe(1); // Tage in der Zukunft zählen nicht
  });
  it("bester Tag: die meisten Leads an einem Tag im Zeitraum – bei Gleichstand der jüngere", () => {
    const days = [day("A", "2026-11-10", 9, 4), day("A", "2026-11-17", 8, 4), day("A", "2026-11-18", 5, 2), day("A", "2026-10-01", 9, 7)];
    expect(bestDayOf(days, "2026-11-01")).toEqual({ day: "2026-11-17", approved: 4 }); expect(bestDayOf(days, null)).toEqual({ day: "2026-10-01", approved: 7 });
    expect(bestDayOf([day("A", "2026-11-18", 5, 0)], null)).toBeNull();
    expect(bestDayOf(days, "2026-11-01", "2026-11-16")).toEqual({ day: "2026-11-10", approved: 4 }); // ein abgeschlossener Zeitraum: spätere Tage zählen nicht
  });
});

describe("Bestenliste – womit verglichen wird", () => {
  const days = [day("A", "2026-11-19", 2, 1), day("A", "2026-11-18", 2, 1), day("B", "2026-11-13", 2, 1)];
  it("„Heute“ vergleicht mit dem letzten Tag, an dem telefoniert wurde – am Montag also mit dem Freitag", () => {
    expect(previousSpan("heute", TODAY, days)).toEqual({ fromDay: "2026-11-18", beforeDay: "2026-11-19" });
    expect(previousSpan("heute", "2026-11-16", days)).toEqual({ fromDay: "2026-11-13", beforeDay: "2026-11-14" });
    expect(previousSpan("heute", "2026-11-30", days)).toBeNull(); // mehr als eine Woche her
    expect(previousSpan("heute", TODAY, [])).toBeNull();
  });
  it("7 und 30 Tage vergleichen mit genauso vielen Tagen davor; „Gesamt“ hat keinen Vergleich", () => {
    expect(previousSpan("7", TODAY, days)).toEqual({ fromDay: "2026-11-06", beforeDay: "2026-11-13" }); // Zeitraum selbst: 13.–19.
    expect(previousSpan("30", TODAY, days)).toEqual({ fromDay: "2026-09-21", beforeDay: "2026-10-21" }); // Zeitraum selbst: 21.10.–19.11.
    expect(previousSpan("alle", TODAY, days)).toBeNull();
  });
  it("weitere Zeiträume: Woche gegen Woche, Monat gegen Monat – ein einzelner Tag gegen den letzten Tag mit Gesprächen", () => {
    const span = (input: Parameters<typeof callPeriodSpan>[0], today = TODAY) => callPeriodSpan(input, today);
    expect(previousSpan(span({ period: "woche" }), TODAY, days)).toEqual({ fromDay: "2026-11-09", beforeDay: "2026-11-13" }); // diese Woche Mo–Do gegen letzte Woche Mo–Do
    expect(previousSpan(span({ period: "woche" }, "2026-11-16"), "2026-11-16", days)).toEqual({ fromDay: "2026-11-09", beforeDay: "2026-11-10" }); // am Montag: Montag gegen Montag
    expect(previousSpan(span({ period: "letzte_woche" }), TODAY, days)).toEqual({ fromDay: "2026-11-02", beforeDay: "2026-11-09" });
    expect(previousSpan(span({ period: "letzte_2_wochen" }), TODAY, days)).toEqual({ fromDay: "2026-10-19", beforeDay: "2026-11-02" });
    expect(previousSpan(span({ period: "monat" }), TODAY, days)).toEqual({ fromDay: "2026-10-01", beforeDay: "2026-10-20" }); // 1.–19.11. gegen 1.–19.10.
    expect(previousSpan(span({ period: "monat" }, "2026-03-31"), "2026-03-31", days)).toEqual({ fromDay: "2026-02-01", beforeDay: "2026-03-01" }); // der Februar hat keinen 31. – dann der ganze Monat
    expect(previousSpan(span({ period: "letzter_monat" }), TODAY, days)).toEqual({ fromDay: "2026-09-01", beforeDay: "2026-10-01" });
    expect(previousSpan(span({ period: "gestern" }), TODAY, days)).toEqual({ fromDay: "2026-11-13", beforeDay: "2026-11-14" }); // gestern (18.) gegen den letzten Tag mit Gesprächen davor
    expect(previousSpan(span({ from: "2026-11-19", to: "2026-11-19" }), TODAY, days)).toEqual({ fromDay: "2026-11-18", beforeDay: "2026-11-19" });
    expect(previousSpan(span({ from: "2026-11-10", to: "2026-11-14" }), TODAY, days)).toEqual({ fromDay: "2026-11-05", beforeDay: "2026-11-10" }); // fünf Tage gegen die fünf davor
    expect(previousSpan(span({ from: "2026-11-10" }), TODAY, days)).toEqual({ fromDay: "2026-10-31", beforeDay: "2026-11-10" }); // ab dem 10. bis heute sind zehn Tage – verglichen wird mit den zehn davor
  });
  it("kein Vergleich bei „vor …“, in der Zukunft, über ein Vierteljahr oder weiter zurück als ein Jahr", () => {
    const span = (input: Parameters<typeof callPeriodSpan>[0]) => callPeriodSpan(input, TODAY);
    expect(previousSpan(span({ to: "2026-11-05" }), TODAY, days)).toBeNull(); expect(previousSpan(span({ from: "2026-12-01" }), TODAY, days)).toBeNull();
    expect(previousSpan(span({ from: shiftDay(TODAY, -(COMPARE_MAX_DAYS - 1)) }), TODAY, days)).not.toBeNull(); expect(previousSpan(span({ from: shiftDay(TODAY, -COMPARE_MAX_DAYS) }), TODAY, days)).toBeNull();
    expect(previousSpan(span({ from: "2025-09-01", to: "2025-09-30" }), TODAY, days)).toBeNull(); // der Abschnitt davor läge mehr als ein Jahr zurück
  });
  it("so weit zurück werden die Tageszeilen gebraucht: 62 Tage, der Zeitraum und der Abschnitt davor – höchstens ein Jahr", () => {
    const start = (input: Parameters<typeof callPeriodSpan>[0]) => dayWindowStart(callPeriodSpan(input, TODAY), TODAY);
    expect(start({ period: "heute" })).toBe(shiftDay(TODAY, -61)); expect(start({ period: "30" })).toBe(shiftDay(TODAY, -61)); expect(start({ period: "letzter_monat" })).toBe("2026-09-01"); // der September ist der Abschnitt davor
    expect(start({ period: "alle" })).toBe(shiftDay(TODAY, -365)); expect(start({ to: "2026-11-05" })).toBe(shiftDay(TODAY, -365));
    expect(start({ from: "2026-07-01", to: "2026-07-31" })).toBe("2026-05-31"); expect(start({ from: "2020-01-01" })).toBe(shiftDay(TODAY, -365)); // nie mehr als ein Jahr
    expect(start({ from: "2026-08-03", to: "2026-08-03" })).toBe("2026-07-27"); // ein einzelner Tag: eine Woche davor für den Vergleich
  });
  it("Tageszeilen eines Abschnitts werden je Agent zusammengezählt – „Ohne Agent“ bleibt für die Summe dabei", () => {
    const rows = countFromDays([day("A", "2026-11-06", 3, 1, 2), day("A", "2026-11-12", 2, 1, 2), day("A", "2026-11-13", 9, 9), day(NO_AGENT, "2026-11-10", 4, 1, 3)], { fromDay: "2026-11-06", beforeDay: "2026-11-13" });
    expect(rows).toEqual(expect.arrayContaining([{ name: "A", calls: 5, approved: 2, evaluated: 4 }, { name: NO_AGENT, calls: 4, approved: 1, evaluated: 3 }])); expect(rows.length).toBe(2);
  });
});

describe("Bestenliste – Reihenfolge", () => {
  it("meiste Leads zuerst, dann der höhere Grün-Anteil, dann Termine, Interessenten, Gespräche, Punkte – zuletzt der Name", () => {
    const list = [{ name: "D", approved: 5, evaluated: 10, calls: 10 }, { name: "A", approved: 5, evaluated: 20, calls: 20 }, { name: "C", approved: 7, evaluated: 30, calls: 30 }, { name: "B", approved: 5, evaluated: 20, calls: 20 }];
    expect([...list].sort(compareAgents).map((item) => item.name)).toEqual(["C", "D", "A", "B"]);
    expect([{ name: "X", approved: 2, evaluated: 4, calls: 4 }, { name: "Y", approved: 2, evaluated: 4, calls: 4, appointments: 1 }].sort(compareAgents).map((item) => item.name)).toEqual(["Y", "X"]);
    expect([{ name: "X", approved: 2, evaluated: 4, calls: 4 }, { name: "Y", approved: 2, evaluated: 4, calls: 9 }].sort(compareAgents).map((item) => item.name)).toEqual(["Y", "X"]);
  });
  it("„Ohne Agent“ steht immer unten – außer ein Benutzer heißt wirklich so", () => {
    expect([{ name: NO_AGENT, approved: 99, evaluated: 99, calls: 99 }, { name: "A", approved: 0, evaluated: 0, calls: 1 }].sort(compareAgents).map((item) => item.name)).toEqual(["A", NO_AGENT]);
    expect([{ name: "A", approved: 0, evaluated: 0, calls: 1 }, { name: NO_AGENT, userId: 7, approved: 99, evaluated: 99, calls: 99 }].sort(compareAgents).map((item) => item.name)).toEqual([NO_AGENT, "A"]);
  });
});

describe("Bestenliste – fertige Liste", () => {
  // 7 Tage: 13.–19.11. – verglichen mit 6.–12.11.
  const span = { fromDay: "2026-11-06", beforeDay: "2026-11-13" };
  const days: AgentDay[] = [
    // Ada: jeden Arbeitstag ein Lead, heute zwei
    day("Ada", "2026-11-19", 6, 2), day("Ada", "2026-11-18", 5, 1), day("Ada", "2026-11-17", 5, 1), day("Ada", "2026-11-16", 4, 1), day("Ada", "2026-11-13", 4, 1), day("Ada", "2026-11-12", 3, 1), day("Ada", "2026-11-10", 3, 0),
    // Ben: davor stark (Platz 1), jetzt schwächer
    day("Ben", "2026-11-19", 4, 0), day("Ben", "2026-11-17", 6, 3), day("Ben", "2026-11-11", 8, 5), day("Ben", "2026-11-09", 6, 3),
    // Cem: neu dabei – erstes Gespräch im Zeitraum
    day("Cem", "2026-11-18", 7, 4), day("Cem", "2026-11-19", 3, 1),
    // Dua: vorher hinten, jetzt vorn dabei
    day("Dua", "2026-11-16", 6, 5), day("Dua", "2026-11-07", 2, 0),
    day(NO_AGENT, "2026-11-19", 2, 1), day(NO_AGENT, "2026-11-08", 5, 2),
  ];
  const buckets = [
    bucket("Ada", { calls: 24, reached: 24, talkSeconds: 5400, evaluated: 24, scoreSum: 24 * 70, approved: 6, review: 10, rejected: 8 }),
    bucket("Ben", { calls: 10, reached: 10, talkSeconds: 9000, evaluated: 10, scoreSum: 10 * 60, approved: 3, review: 3, rejected: 4 }),
    bucket("Cem", { calls: 10, reached: 10, talkSeconds: 2400, evaluated: 8, scoreSum: 8 * 80, approved: 5, review: 2, rejected: 1 }),
    bucket("Dua", { calls: 6, reached: 6, talkSeconds: 1500, evaluated: 6, scoreSum: 6 * 90, approved: 5, review: 1, rejected: 0 }),
    bucket(NO_AGENT, { calls: 2, reached: 2, talkSeconds: 300, evaluated: 2, scoreSum: 100, approved: 1, review: 0, rejected: 1 }),
  ];
  const report = finishAgentReport({ buckets, days, allTime: [{ name: "Ada", approved: 120 }, { name: "Ben", approved: 26 }, { name: "Dua", approved: 2 }], previous: span, today: TODAY, fromDay: "2026-11-13" });
  const of = (name: string) => report.agents.find((agent) => agent.name === name)!;

  it("Plätze: meiste Leads zuerst, bei Gleichstand der höhere Grün-Anteil – „Ohne Agent“ ohne Platz ganz unten", () => {
    expect(report.agents.map((agent) => [agent.name, agent.rank])).toEqual([["Ada", 1], ["Dua", 2], ["Cem", 3], ["Ben", 4], [NO_AGENT, null]]);
    expect(of("Dua").greenRate).toBe(83); expect(of("Cem").greenRate).toBe(63); // 5 von 6 schlägt 5 von 8
  });
  it("Auf- und Abstieg gegenüber dem Abschnitt davor; „neu“ nur, wer vorher gar nicht telefoniert hat", () => {
    // davor: Ben 8 Leads (Platz 1), Ada 1 (Platz 2), Dua 0 (Platz 3) – Cem war nicht dabei
    expect([of("Ben").previousRank, of("Ben").rankChange]).toEqual([1, -3]); expect([of("Ada").previousRank, of("Ada").rankChange]).toEqual([2, 1]); expect([of("Dua").previousRank, of("Dua").rankChange]).toEqual([3, 1]);
    expect([of("Cem").previousRank, of("Cem").rankChange, of("Cem").isNew]).toEqual([null, null, true]); expect(of("Ada").isNew).toBe(false); expect(of(NO_AGENT).isNew).toBe(false);
  });
  it("Abstand zum Platz davor in Leads – 0 heißt gleichauf", () => {
    expect(of("Ada").gap).toBeNull(); expect(of("Dua").gap).toEqual({ rank: 1, name: "Ada", missing: 1 }); expect(of("Cem").gap).toEqual({ rank: 2, name: "Dua", missing: 0 }); expect(of("Ben").gap).toEqual({ rank: 3, name: "Cem", missing: 2 }); expect(of(NO_AGENT).gap).toBeNull();
  });
  it("Serie, Leads heute und bester Tag je Agent", () => {
    expect([of("Ada").streak, of("Ada").approvedToday, of("Ada").bestDay]).toEqual([6, 2, { day: "2026-11-19", approved: 2 }]); // 12.,13.,16.,17.,18.,19. – der 10. (0 Leads) beendet sie
    expect([of("Ben").streak, of("Ben").approvedToday]).toEqual([3, 0]); // heute läuft noch: 17., 11., 9.
    expect(of("Cem").bestDay).toEqual({ day: "2026-11-18", approved: 4 }); expect(of(NO_AGENT).streak).toBe(0); expect(of(NO_AGENT).bestDay).toBeNull();
  });
  it("Stufe aus den Leads insgesamt – mindestens so viele wie im Zeitraum", () => {
    expect([of("Ada").approvedAllTime, of("Ada").level.name]).toEqual([120, "Meister"]); expect(of("Ben").level.name).toBe("Profi");
    expect([of("Dua").approvedAllTime, of("Dua").level.name]).toEqual([5, "Neuling"]); // „insgesamt“ hinkt hinterher – es zählt der höhere Wert
    expect([of("Cem").approvedAllTime, of("Cem").level.next]).toEqual([5, { name: "Talent", at: 10, missing: 5 }]);
  });
  it("Summen: alle zusammen, heute und der Abschnitt davor – „Ohne Agent“ zählt in den Summen mit", () => {
    expect(report.totals).toMatchObject({ agents: 5, calls: 52, approved: 20, review: 16, rejected: 14, evaluated: 50, talkSeconds: 18600, approvedToday: 4, callsToday: 15, approvedBefore: 11 });
    expect(report.totals.averageScore).toBe(Math.round((24 * 70 + 10 * 60 + 8 * 80 + 6 * 90 + 100) / 50));
  });
  it("Bestwerte: Quote braucht genug Gespräche, Serie und bester Tag mindestens zwei – „Ohne Agent“ gewinnt nie", () => {
    const awards = Object.fromEntries(report.awards.map((award) => [award.key, award]));
    expect(awards.quote).toMatchObject({ name: "Dua", value: 83, extra: 6 }); expect(awards.serie).toMatchObject({ name: "Ada", value: 6 });
    expect(awards.tag).toMatchObject({ name: "Dua", value: 5, extra: "2026-11-16" }); expect(awards.aufsteiger).toMatchObject({ name: "Ada", value: 1, extra: 2 }); // Ada und Dua je +1 – die mit mehr Leads
    expect(awards.gespraeche).toMatchObject({ name: "Ada", value: 24 }); expect(awards.telefon).toMatchObject({ name: "Ben", value: 9000 }); expect(awards.termine).toBeUndefined();
    expect(QUOTE_MIN_CALLS).toBe(5);
    const few = finishAgentReport({ buckets: [bucket("Eli", { calls: 1, reached: 1, evaluated: 1, approved: 1 }), bucket("Fee", { calls: 9, reached: 9, evaluated: 9, approved: 2, dispositions: { verkauft: 2, interessiert: 1 } }, 4)], days: [], allTime: [], previous: null, today: TODAY, fromDay: null });
    expect(few.awards.find((award) => award.key === "quote")).toMatchObject({ name: "Fee", value: 22 }); // Eli: 1 von 1 reicht nicht
    expect(few.awards.find((award) => award.key === "termine")).toMatchObject({ name: "Fee", value: 2, userId: 4 }); expect(few.awards.some((award) => award.key === "serie" || award.key === "tag" || award.key === "aufsteiger")).toBe(false);
    expect(few.agents[0]).toMatchObject({ name: "Fee", appointments: 2, interested: 1, successRate: 33, previousRank: null, rankChange: null, isNew: false }); expect(few.totals.approvedBefore).toBeNull();
  });
  it("doppelte Tageszeilen (Leerzeichen am Namen) zählen nicht doppelt", () => {
    const merged = finishAgentReport({ buckets: [bucket("Ada", { calls: 4, evaluated: 4, approved: 2 })], days: [day("Ada", "2026-11-19", 2, 1), day("Ada ", "2026-11-19", 2, 1), day("Ada", "2026-11-18", 1, 1)], allTime: [{ name: "Ada", approved: 3 }, { name: " Ada", approved: 4 }], previous: null, today: TODAY, fromDay: null });
    expect(merged.agents[0]).toMatchObject({ streak: 2, approvedToday: 2, approvedAllTime: 7, bestDay: { day: "2026-11-19", approved: 2 } }); expect(merged.totals.callsToday).toBe(4);
  });
  it("verschiedene Schreibweisen eines Namens finden zusammen: Tage, Leads insgesamt und der Abschnitt davor zählen für denselben Agenten", () => {
    // Die Datenbank fasst „José“ und „jose“ zusammen und liefert je Abfrage eine der Schreibweisen – in der Liste steht die aus dem Zeitraum
    const mixed = finishAgentReport({
      buckets: [bucket("José Álvarez", { calls: 4, evaluated: 4, approved: 3 }), bucket("Ben", { calls: 4, evaluated: 4, approved: 1 })],
      days: [day("jose alvarez", "2026-11-19", 2, 2), day("JOSÉ ÁLVAREZ", "2026-11-18", 2, 1), day("Jose Alvarez ", "2026-11-10", 5, 0), day("Ben", "2026-11-19", 4, 1), day("Ben", "2026-11-11", 6, 4)],
      allTime: [{ name: "jose alvarez", approved: 30 }, { name: "José Álvarez", approved: 2 }, { name: "Ben", approved: 5 }], previous: { fromDay: "2026-11-06", beforeDay: "2026-11-13" }, today: TODAY, fromDay: "2026-11-13",
    });
    expect(mixed.agents.map((agent) => agent.name)).toEqual(["José Álvarez", "Ben"]);
    expect(mixed.agents[0]).toMatchObject({ streak: 2, approvedToday: 2, bestDay: { day: "2026-11-19", approved: 2 }, approvedAllTime: 32, previousRank: 2, rankChange: 1, isNew: false }); expect(mixed.agents[0].level.name).toBe("Profi");
    expect(mixed.agents[1]).toMatchObject({ previousRank: 1, rankChange: -1 });
  });
  it("leer bleibt leer", () => { const empty = finishAgentReport({ buckets: [], days: [], allTime: [], previous: null, today: TODAY, fromDay: null }); expect(empty.agents).toEqual([]); expect(empty.awards).toEqual([]); expect(empty.totals).toMatchObject({ agents: 0, calls: 0, approved: 0, averageScore: null, reachRate: null }); });
});

describe("Bestenliste – Bausteine aus einzelnen Gesprächen (Vorschau)", () => {
  const facts = [
    { name: "Ada", at: new Date("2026-11-19T09:00:00Z"), approved: true, evaluated: true }, { name: " Ada ", at: new Date("2026-11-19T10:00:00Z"), approved: false, evaluated: true },
    { name: "Ada", at: new Date("2026-11-18T23:30:00Z"), approved: true, evaluated: false }, // nach Mitternacht deutscher Zeit → zählt zum 19.
    { name: null, at: new Date("2026-11-19T11:00:00Z"), approved: true, evaluated: true }, { name: "Ben", at: null, approved: true, evaluated: true },
  ];
  it("je Agent und Tag in deutscher Zeit; ohne Uhrzeit zählt ein Gespräch dort nicht", () => {
    expect(countAgentDays(facts)).toEqual(expect.arrayContaining([{ name: "Ada", day: "2026-11-19", calls: 3, approved: 2, evaluated: 2 }, { name: NO_AGENT, day: "2026-11-19", calls: 1, approved: 1, evaluated: 1 }])); expect(countAgentDays(facts).length).toBe(2);
  });
  it("je Agent insgesamt – ohne „Ohne Agent“", () => { expect(countAgents(facts)).toEqual(expect.arrayContaining([{ name: "Ada", calls: 3, approved: 2, evaluated: 2 }, { name: "Ben", calls: 1, approved: 1, evaluated: 1 }])); expect(countAgents(facts).length).toBe(2); });
});

/** Agenten von Hand löschen: Der Name steht auf einer Liste – überall in der Bestenliste zählt er dann nicht mehr mit, bis er zurückgeholt wird. */
describe("Bestenliste – gelöschte Agenten (v378)", () => {
  const now = new Date("2026-11-19T10:00:00Z");
  it("löschen und zurückholen – Schreibweise, Akzente und Leerzeichen spielen keine Rolle; „Ohne Agent“ lässt sich nicht löschen", () => {
    const one = hideAgentIn([], "  José Álvarez ", "Taner", now); expect(one).toEqual([{ name: "José Álvarez", at: "2026-11-19T10:00:00.000Z", by: "Taner" }]);
    expect(hideAgentIn(one, "JOSE ALVAREZ", "Francesco", now)).toBe(one); // steht schon dort – der erste Eintrag bleibt
    expect(hideAgentIn(one, "Ohne Agent", null, now)).toBe(one); expect(hideAgentIn(one, "   ", null, now)).toBe(one);
    const two = hideAgentIn(one, "Deniz Kaya", null, now); expect(two.map((item) => item.name)).toEqual(["José Álvarez", "Deniz Kaya"]); expect(two[1].by).toBeNull();
    expect(Array.from(hiddenAgentKeys(two))).toEqual(["jose alvarez", "deniz kaya"]);
    expect(restoreAgentIn(two, "jose alvarez").map((item) => item.name)).toEqual(["Deniz Kaya"]); expect(restoreAgentIn(two, "Niemand")).toEqual(two); expect(restoreAgentIn(two, "")).toBe(two);
  });
  it("gespeicherte Liste lesen: kaputte Einträge fallen weg, jeder Name steht nur einmal da", () => {
    expect(readHiddenAgents(null)).toEqual([]); expect(readHiddenAgents("x")).toEqual([]); expect(readHiddenAgents({ name: "A" })).toEqual([]);
    const list = readHiddenAgents([{ name: " Deniz Kaya ", at: "2026-11-01T08:00:00.000Z", by: " Taner " }, { name: "DENIZ KAYA", at: "2026-11-02T08:00:00.000Z" }, { name: "" }, null, 7, { name: "Ohne Agent" }, { name: "Ali Demir", at: "kaputt", by: 5 }]);
    expect(list).toEqual([{ name: "Deniz Kaya", at: "2026-11-01T08:00:00.000Z", by: "Taner" }, { name: "Ali Demir", at: "1970-01-01T00:00:00.000Z", by: null }]);
  });
  it("gelöschte Agenten fehlen überall: Zahlen im Zeitraum, Tageszeilen, insgesamt, zuletzt erreicht – und stehen mit ihren Zahlen in der Liste der Gelöschten", () => {
    const hidden = hideAgentIn(hideAgentIn([], "Deniz Kaya", "Taner", now), "Niemand Mehr", null, now);
    const buckets = [bucket("Ali Demir", { calls: 10, approved: 4, evaluated: 8 }), bucket("deniz kaya", { calls: 6, approved: 3, evaluated: 6 }), bucket("Deniz Kaya", { calls: 2, approved: 1, evaluated: 2 }, 7), bucket(NO_AGENT, { calls: 3, approved: 1, evaluated: 3 })];
    const days = [day("Ali Demir", "2026-11-19", 4, 2), day("DENIZ KAYA", "2026-11-19", 3, 2), day(NO_AGENT, "2026-11-19", 1, 0)];
    const kept = withoutHiddenAgents({ hidden, buckets, days, allTime: [{ name: "Ali Demir", approved: 40 }, { name: "Deniz Kaya", approved: 90 }], wins: [{ name: "Deniz Kaya", callId: 1 }, { name: "Ali Demir", callId: 2 }, { name: null, callId: 3 }] });
    expect(kept.buckets.map((item) => item.name)).toEqual(["Ali Demir", NO_AGENT]); expect(kept.days.map((item) => item.name)).toEqual(["Ali Demir", NO_AGENT]); expect(kept.allTime).toEqual([{ name: "Ali Demir", approved: 40 }]); expect(kept.wins.map((item) => item.callId)).toEqual([2, 3]);
    expect(kept.hiddenAgents).toEqual([{ name: "Deniz Kaya", at: now.toISOString(), by: "Taner", calls: 8, approved: 4 }, { name: "Niemand Mehr", at: now.toISOString(), by: null, calls: 0, approved: 0 }]); // beide Schreibweisen zusammengezählt
    // die Bestenliste daraus: Der Gelöschte hat keinen Platz, die Summe der Mannschaft zählt ihn nicht mit
    const report = finishAgentReport({ buckets: kept.buckets, days: kept.days, allTime: kept.allTime, previous: null, today: TODAY, fromDay: "2026-11-01" });
    expect(report.agents.map((agent) => [agent.name, agent.rank])).toEqual([["Ali Demir", 1], [NO_AGENT, null]]); expect(report.totals).toMatchObject({ agents: 2, calls: 13, approved: 5, approvedToday: 2, callsToday: 5 });
  });
  it("ohne gelöschte Agenten bleibt alles, wie es ist", () => {
    const buckets = [bucket("Ali Demir", { calls: 1 })]; const kept = withoutHiddenAgents({ hidden: [], buckets, days: [], allTime: [], wins: [] });
    expect(kept.buckets).toBe(buckets); expect(kept.hiddenAgents).toEqual([]);
  });
});
