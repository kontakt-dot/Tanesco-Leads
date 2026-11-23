import { describe, expect, it } from "vitest";
import { costMilliCents, transcriptionMilliCents, TRANSCRIPTION_USD_PER_MINUTE } from "./ai-budget";
import { aiUsageHistory, purposeInfo } from "../shared/ai-usage";

describe("KI-Verbrauch der Gespräche", () => {
  it("Abschrift kostet nach Minuten: OpenAI 0,006 $ je Minute, Deepgram weniger – umgerechnet in Euro", () => {
    expect(TRANSCRIPTION_USD_PER_MINUTE).toEqual({ openai: 0.006, deepgram: 0.0043 });
    expect(transcriptionMilliCents("openai", 60)).toBe(552); // 0,55 Cent je Minute
    expect(transcriptionMilliCents("openai", 300)).toBe(2760); expect(transcriptionMilliCents("deepgram", 300)).toBe(1978);
    expect(transcriptionMilliCents("openai", 0)).toBe(0); expect(transcriptionMilliCents("openai", Number.NaN)).toBe(0); expect(transcriptionMilliCents("unbekannt", 600)).toBe(0);
  });
  it("ein Gespräch von 5 Minuten kostet zusammen rund 5 Cent: Abschrift plus Bewertung plus die kleinen Fragen", () => {
    const transcript = transcriptionMilliCents("openai", 300);
    const rating = costMilliCents({ model: "claude-sonnet-4-6", purpose: "gespraechsbewertung", input: 2300, output: 800, cacheRead: 0, cacheWrite: 0 });
    const small = 4 * costMilliCents({ model: "claude-haiku-4-5", purpose: "qualifizierung", input: 1800, output: 250, cacheRead: 0, cacheWrite: 0 });
    const cents = (transcript + rating + small) / 1000; expect(cents).toBeGreaterThan(4); expect(cents).toBeLessThan(7);
  });
  it("die Abschrift steht in der Übersicht im Bereich „Gespräche“ – als eigener Zweck", () => {
    expect(purposeInfo("abschrift")).toEqual({ label: "Gespräche mitschreiben (Abschrift)", area: "gespraeche" });
    const history = aiUsageHistory([{ day: "2026-11-23", purpose: "abschrift", calls: 10, costMilliCents: 27_600 }, { day: "2026-11-23", purpose: "gespraechsbewertung", calls: 10, costMilliCents: 20_000 }, { day: "2026-11-23", purpose: "vorschlaege", calls: 4, costMilliCents: 10_000 }], "2026-11-23", 7);
    const day = history.days[6]; expect(day.areas).toMatchObject({ gespraeche: 48, kampagnen: 10 }); expect(day.parts.map((part) => part.label)).toEqual(["Gespräche mitschreiben (Abschrift)", "Gespräche bewerten", "E-Mail-Entwürfe"]);
  });
});
