import { describe, expect, it } from "vitest";
import { clock, criterionMark, locateByWords, markItems, normalizeSegments, parseClock, previewLength, previewSource, questionMark, readTimeline, segmentIndexAt, snapToSegment, timedTranscript, timelineStateOf, type CallSegment } from "../shared/call-timeline";

const SEGMENTS: CallSegment[] = [
  { s: 0, e: 6.2, t: "Guten Tag, hier ist Maja Becker von HausKompass." },
  { s: 6.2, e: 14, t: "Sie hatten sich für eine Wärmepumpe interessiert, richtig?" },
  { s: 14, e: 21.5, t: "Ja genau, unsere alte Gasheizung soll raus." },
  { s: 21.5, e: 33, t: "Und Sie sind der Eigentümer oder entscheidungsbefugt?" },
  { s: 33, e: 36.4, t: "Ich bin Eigentümer." },
  { s: 36.4, e: 52, t: "Wann möchten Sie das umsetzen, eher zeitnah oder in ein bis drei Monaten?" },
  { s: 52, e: 60, t: "Na ja, hätte ich gesagt, gleich dann. Wenn es mir passt." },
  { s: 91, e: 99, t: "Dürfen wir Ihre Daten an einen Fachbetrieb weitergeben?" },
  { s: 99, e: 104, t: "Nein, das möchte ich nicht, bitte keine Weitergabe." },
];

describe("Zeitmarken im Gespräch", () => {
  it("schreibt Zeiten wie eine Uhr und liest sie wieder", () => {
    expect(clock(0)).toBe("0:00"); expect(clock(91)).toBe("1:31"); expect(clock(91.9)).toBe("1:31"); expect(clock(600)).toBe("10:00"); expect(clock(3725)).toBe("1:02:05"); expect(clock(-3)).toBe("0:00"); expect(clock(Number.NaN)).toBe("0:00");
    expect(parseClock("1:31")).toBe(91); expect(parseClock("01:31")).toBe(91); expect(parseClock("[1:31]")).toBe(91); expect(parseClock("1:02:05")).toBe(3725); expect(parseClock("91")).toBe(91); expect(parseClock(91)).toBe(91); expect(parseClock("1:31 Min")).toBe(91);
    for (const bad of ["", "  ", "bald", "1:75", "ein Uhr", null, undefined, -4, Number.NaN]) expect(parseClock(bad), String(bad)).toBeNull();
  });

  it("säubert Abschnitte aus der Umwandlung in Text – egal, ob sie von Whisper oder Deepgram kommen", () => {
    const whisper = normalizeSegments([{ id: 0, start: 6.24, end: 14.01, text: "  Sie hatten sich   interessiert? " }, { id: 1, start: 0, end: 6.2, text: "Guten Tag." }, { start: "x", text: "weg" }, { start: 3, text: "   " }, null, "x"]);
    expect(whisper).toEqual([{ s: 0, e: 6.2, t: "Guten Tag." }, { s: 6.2, e: 14, t: "Sie hatten sich interessiert?" }]); // nach Zeit sortiert, Leerraum bereinigt, auf Zehntel gerundet
    expect(normalizeSegments([{ start: 2, end: 5, speaker: 1, transcript: "Ja gerne." }])).toEqual([{ s: 2, e: 5, t: "Ja gerne.", sp: 1 }]); // Deepgram: Sprecher bleibt erhalten
    expect(normalizeSegments([{ start: 8, end: 3, text: "Ende vor Beginn" }])[0]).toMatchObject({ s: 8, e: 8 });
    expect(normalizeSegments(null)).toEqual([]); expect(normalizeSegments("text")).toEqual([]);
    expect(normalizeSegments(Array.from({ length: 2000 }, (_, index) => ({ start: index, end: index + 1, text: "x" }))).length).toBe(1500);
  });

  it("liest gespeicherte Zeitmarken und wirft Unbrauchbares weg", () => {
    expect(readTimeline(null)).toBeNull(); expect(readTimeline([])).toBeNull(); expect(readTimeline("x")).toBeNull();
    const timeline = readTimeline({ segments: SEGMENTS, marks: { "q:eigentuemer": 33, "c:zeitrahmen": "52", "x:fremd": 4, "q:": 3, "q:kaputt": "bald", "q:minus": -1 }, note: "  " });
    expect(timeline?.segments.length).toBe(SEGMENTS.length); expect(timeline?.marks).toEqual({ "q:eigentuemer": 33, "c:zeitrahmen": 52 }); expect(timeline?.note).toBeUndefined();
    expect(readTimeline({ segments: [], marks: {}, note: "Die Aufnahme ließ sich nicht mehr laden." })).toEqual({ segments: [], marks: {}, note: "Die Aufnahme ließ sich nicht mehr laden." });
  });

  it("gibt der KI die Abschrift mit Zeitmarke am Zeilenanfang", () => {
    const text = timedTranscript(SEGMENTS); const lines = text.split("\n");
    expect(lines.length).toBe(SEGMENTS.length); expect(lines[0]).toBe("[0:00] Guten Tag, hier ist Maja Becker von HausKompass."); expect(lines[7]).toBe("[1:31] Dürfen wir Ihre Daten an einen Fachbetrieb weitergeben?");
    expect(timedTranscript([{ s: 5, e: 9, t: "Hallo.", sp: 0 }, { s: 9, e: 12, t: "Ja?", sp: 1 }])).toBe("[0:05] Sprecher 1: Hallo.\n[0:09] Sprecher 2: Ja?");
  });

  it("findet den Abschnitt zu einer Zeit und zieht eine genannte Zeit an den Satzanfang", () => {
    expect(segmentIndexAt(SEGMENTS, 0)).toBe(0); expect(segmentIndexAt(SEGMENTS, 33.9)).toBe(4); expect(segmentIndexAt(SEGMENTS, 70)).toBe(6); expect(segmentIndexAt(SEGMENTS, 500)).toBe(8); expect(segmentIndexAt([{ s: 4, e: 6, t: "x" }], 1)).toBe(-1);
    expect(snapToSegment(SEGMENTS, 35)).toBe(33); expect(snapToSegment(SEGMENTS, 91)).toBe(91); expect(snapToSegment(SEGMENTS, 95.5)).toBe(91); expect(snapToSegment(SEGMENTS, 0)).toBe(0);
    expect(snapToSegment(SEGMENTS, 108)).toBe(99); // knapp nach dem Ende: letzter Abschnitt
    expect(snapToSegment(SEGMENTS, 400)).toBeNull(); expect(snapToSegment(SEGMENTS, -1)).toBeNull(); expect(snapToSegment(SEGMENTS, null)).toBeNull(); expect(snapToSegment([], 10)).toBeNull();
  });

  it("findet die Stelle auch ohne KI: wörtliche Zitate zuerst, sonst die passendsten Wörter", () => {
    // Zitat im Beleg – genau diese Stelle
    expect(locateByWords(SEGMENTS, "Der Kunde bestätigt auf direkte Nachfrage: „Und Sie sind der Eigentümer oder entscheidungsbefugt? – Ich bin Eigentümer.“")).toBe(21.5);
    expect(locateByWords(SEGMENTS, "Der Kunde antwortet: \"Na ja, hätte ich gesagt, gleich dann. Wenn es mir passt.\" Er möchte zeitnah umsetzen.")).toBe(52);
    // ohne Zitat: die Wörter des Belegs
    expect(locateByWords(SEGMENTS, "Der Kunde lehnt die Weitergabe seiner Daten an einen Fachbetrieb ab.")).toBe(91);
    expect(locateByWords(SEGMENTS, "Kunde möchte keine Weitergabe, bitte nicht.")).toBe(99);
    // nichts Passendes: keine erfundene Stelle
    expect(locateByWords(SEGMENTS, "Über einen Wintergarten wurde nicht gesprochen.")).toBeNull();
    expect(locateByWords(SEGMENTS, "")).toBeNull(); expect(locateByWords(SEGMENTS, null)).toBeNull(); expect(locateByWords([], "Eigentümer der Immobilie")).toBeNull();
  });

  it("stellt die Punkte der Bewertung zusammen: Fragen mit Antwort, Kriterien mit Punkten – was entfällt oder fehlt, bleibt weg", () => {
    const questions = [{ key: "eigentuemer", label: "Ist der Kunde Eigentümer?" }, { key: "erdgas", label: "Keine Erdgas-Wärmepumpe?" }, { key: "weitergabe", label: "Stimmt der Kunde der Weitergabe zu?" }, { key: "offen", label: "Noch nicht beantwortet" }];
    const answers = { eigentuemer: { answer: "ja", note: "Ich bin Eigentümer." }, erdgas: { answer: "ja", note: "Entfällt – es geht um Photovoltaik" }, weitergabe: { answer: "nein", note: null }, fremd: { answer: "ja" } };
    const criteria = [{ key: "bedarf", label: "Bedarf & Interesse" }, { key: "einwilligung", label: "Weitergabe erlaubt" }, { key: "budget", label: "Budget" }];
    const scores = [{ key: "einwilligung", score: 0, evidence: "Kunde lehnt ab." }, { key: "bedarf", score: 8 }, { key: "_hinweis", score: 0, evidence: "x" }];
    expect(markItems(questions, answers, criteria, scores)).toEqual([
      { id: "q:eigentuemer", kind: "Frage", label: "Ist der Kunde Eigentümer?", result: "Ja", note: "Ich bin Eigentümer." },
      { id: "q:weitergabe", kind: "Frage", label: "Stimmt der Kunde der Weitergabe zu?", result: "Nein", note: "" },
      { id: "c:bedarf", kind: "Kriterium", label: "Bedarf & Interesse", result: "8 von 10 Punkten", note: "" },
      { id: "c:einwilligung", kind: "Kriterium", label: "Weitergabe erlaubt", result: "0 von 10 Punkten", note: "Kunde lehnt ab." },
    ]);
    expect(markItems(questions, { eigentuemer: { answer: "unklar" } }, [], [])[0]).toMatchObject({ result: "unklar" }); expect(markItems(questions, null, criteria, [])).toEqual([]);
    expect(questionMark("a")).toBe("q:a"); expect(criterionMark("a")).toBe("c:a");
  });

  it("Stand der Zeitmarken: vorhanden, nachholbar oder nicht möglich – mit Grund, wenn schon versucht", () => {
    const base = { transcript: "Agent: Hallo.", recordingUrl: "https://dialer.example/a.mp3", status: "bewertet" };
    expect(timelineStateOf({ ...base, timeline: { segments: SEGMENTS, marks: {} } })).toEqual({ state: "ok", note: null });
    expect(timelineStateOf({ ...base, timeline: null })).toEqual({ state: "fehlt", note: null }); expect(timelineStateOf({ ...base, status: "transkribiert" })).toEqual({ state: "fehlt", note: null });
    expect(timelineStateOf({ ...base, timeline: { segments: [], marks: {}, note: "Zu diesem Gespräch liegt keine Aufnahme vor." } })).toEqual({ state: "ohne", note: "Zu diesem Gespräch liegt keine Aufnahme vor." }); // schon versucht: nicht bei jedem Öffnen wieder
    expect(timelineStateOf({ ...base, timeline: { segments: [], marks: {} } })).toEqual({ state: "ohne", note: null });
    for (const without of [{ ...base, recordingUrl: null }, { ...base, transcript: null }, { ...base, status: "eingegangen" }, { ...base, status: "ohne_einwilligung" }, { ...base, status: "fehlgeschlagen" }, {}]) expect(timelineStateOf(without), JSON.stringify(without)).toEqual({ state: "ohne", note: null });
  });

  it("Vorschau ohne Aufnahme: die Adresse trägt nur die Länge in Sekunden", () => {
    expect(previewSource(366)).toBe("vorschau:366"); expect(previewSource(12.4)).toBe("vorschau:12"); expect(previewSource(0)).toBe("vorschau:60"); expect(previewSource(null)).toBe("vorschau:60"); expect(previewSource(0.2)).toBe("vorschau:1");
    expect(previewLength("vorschau:366")).toBe(366); expect(previewLength(previewSource(91))).toBe(91);
    for (const real of ["/api/aufnahmen/5", "https://dialer.example/a.mp3", "vorschau:", "vorschau:1x", "", null, undefined]) expect(previewLength(real), String(real)).toBe(0);
  });
});
