import { describe, expect, it } from "vitest";
import { aliasKey, aliasProblem, aliasesOf, learnAliases, mergeAliases, readAliases, resolveAlias, sameSpelling, type AgentAlias } from "../shared/agent-alias";
import { spokenAliasFor } from "./agent-alias";
import { isListTag } from "../shared/list-tags";
import { aiUsageHistory, niceCeilCents, purposeInfo } from "../shared/ai-usage";

describe("Alias-Namen der Agenten", () => {
  it("lernt nur klare Paare: ganzer Name, anderer Mensch als der echte Name, eindeutig, oft genug", () => {
    const learned = learnAliases([
      { name: "Deniz Kaya", alias: "Lena Vogt", calls: 5 },
      { name: "Jonas Brandt", alias: "Max Reuter", calls: 1 }, // nur einmal – aber unter „Max Reuter“ gibt es ältere Gespräche
      { name: "Nele Winter", alias: "Sophie Lang", calls: 1 }, // nur einmal und sonst unbekannt: zu wenig
      { name: "Tom Albrecht", alias: "Tom Albrechd", calls: 4 }, // nur anders geschrieben
      { name: "Paula König", alias: "Monika", calls: 9 }, // kein ganzer Name
      { name: "Felix Hahn", alias: "Deniz Kaya", calls: 3 }, // so heißt wirklich jemand
      { name: "Lea Busch", alias: "Karin Wolf", calls: 2 }, { name: "Ben Krüger", alias: "Karin Wolf", calls: 2 }, // derselbe Alias bei zwei Agenten: nicht eindeutig
      { name: "Emma Lorenz", alias: "Mein Name", calls: 6 }, // Füllwort
    ], { spoken: ["Max Reuter", "Lena Vogt"] });
    expect(learned.map((item) => `${item.alias}>${item.name}`)).toEqual(["Lena Vogt>Deniz Kaya", "Max Reuter>Jonas Brandt"]);
    expect(learned[0]).toMatchObject({ source: "gelernt", calls: 5 });
    // 60 % reichen: vier von sechs Gesprächen
    expect(learnAliases([{ name: "Lea Busch", alias: "Karin Wolf", calls: 4 }, { name: "Ben Krüger", alias: "Karin Wolf", calls: 2 }])).toMatchObject([{ alias: "Karin Wolf", name: "Lea Busch", calls: 4 }]);
  });
  it("ein Alias darf dem echten Namen ähneln – dieselbe Schreibweise ist er trotzdem nicht", () => {
    expect(sameSpelling("Derya Bekar", "Maja Becker")).toBe(false); expect(sameSpelling("Emre Demir", "Emre Demier")).toBe(true); expect(sameSpelling("ÖZLEM Sahin", "özlem sahin")).toBe(true); expect(sameSpelling("Sahin", "Özlem Sahin")).toBe(false);
    expect(learnAliases([{ name: "Derya Bekar", alias: "Maja Becker", calls: 3 }])).toMatchObject([{ alias: "Maja Becker", name: "Derya Bekar" }]);
  });
  it("von Hand gilt vor dem Gelernten; „kein Alias“ wird nicht wieder gelernt; einmal Gelerntes bleibt", () => {
    const stored: AgentAlias[] = [{ alias: "Lena Vogt", name: "Mira Schubert", source: "manuell" }, { alias: "Sophie Lang", name: "", source: "manuell" }, { alias: "Alt Gelernt", name: "Tom Albrecht", source: "gelernt", calls: 3 }];
    const merged = mergeAliases(stored, [{ alias: "lena vogt", name: "Deniz Kaya", source: "gelernt", calls: 9 }, { alias: "Sophie Lang", name: "Nele Winter", source: "gelernt", calls: 4 }, { alias: "Max Reuter", name: "Jonas Brandt", source: "gelernt", calls: 2 }]);
    expect(merged.find((item) => aliasKey(item.alias) === "lena vogt")).toMatchObject({ name: "Mira Schubert", source: "manuell" });
    expect(merged.find((item) => item.alias === "Sophie Lang")).toMatchObject({ name: "", source: "manuell" });
    expect(merged.map((item) => item.alias).sort()).toEqual(["Alt Gelernt", "Lena Vogt", "Max Reuter", "Sophie Lang"]);
    expect(resolveAlias("Lena Vogt", merged)).toBe("Mira Schubert"); expect(resolveAlias("LENA  VOGT", merged)).toBe("Mira Schubert"); expect(resolveAlias("Sophie Lang", merged)).toBeNull(); expect(resolveAlias("Max Reuther", merged)).toBe("Jonas Brandt"); // verhört geschrieben
    expect(resolveAlias("Mira Schubert", merged)).toBeNull(); expect(resolveAlias("", merged)).toBeNull(); expect(resolveAlias(null, merged)).toBeNull();
    expect(aliasesOf("mira schubert", merged)).toEqual(["Lena Vogt"]); expect(aliasesOf("Nele Winter", merged)).toEqual([]);
    expect(readAliases([{ alias: " Lena  Vogt ", name: "Deniz Kaya", source: "x", calls: "3" }, { alias: "lena vogt", name: "Doppelt" }, null, "text", { name: "ohne Alias" }])).toEqual([{ alias: "Lena Vogt", name: "Deniz Kaya", source: "gelernt", calls: 3 }]); expect(readAliases(null)).toEqual([]);
    expect(aliasProblem("Le", "Deniz Kaya")).toContain("am Telefon"); expect(aliasProblem("Lena Vogt", "")).toContain("echten Namen"); expect(aliasProblem("Lena Vogt", "lena vogt")).toContain("gleich"); expect(aliasProblem("Lena Vogt", "Deniz Kaya")).toBeNull();
  });
  it("Name der Vorstellung: eindeutige Formel oder der Name, den die KI nennt – nie eine unsichere Fundstelle", () => {
    const talk = "Guten Tag, mein Name ist Lena Vogt von HausKompass. Spreche ich mit Herrn Wegner?";
    expect(spokenAliasFor("Deniz Kaya", talk, null)).toBe("Lena Vogt");
    expect(spokenAliasFor("Lena Vogt", talk, null)).toBe(""); expect(spokenAliasFor("Lena Vogd", talk, null)).toBe(""); // derselbe Name (auch verhört): kein Alias
    expect(spokenAliasFor("Deniz Kaya", "Guten Tag Herr Wegner, es geht um Ihre Anfrage.", "Max Reuter")).toBe("Max Reuter"); expect(spokenAliasFor("Deniz Kaya", "Guten Tag Herr Wegner.", "")).toBe(""); expect(spokenAliasFor("Deniz Kaya", "Guten Tag.", "Monika")).toBe(""); expect(spokenAliasFor(null, talk, null)).toBe("");
  });
});

describe("Listen-Marker und KI-Verbrauch", () => {
  it("„Liste: …“ ist ein Marker der Software, kein Tag für Menschen", () => { expect(isListTag("Liste: Dachdecker Hessen")).toBe(true); expect(isListTag("Hot Lead")).toBe(false); expect(isListTag("Meine Liste: A")).toBe(false); expect(isListTag(null)).toBe(false); });
  it("rechnet je Tag nach Bereich und Zweck – auch Tage ohne Verbrauch stehen drin", () => {
    const history = aiUsageHistory([
      { day: "2026-11-20", purpose: "gespraechsbewertung", calls: 25, costMilliCents: 240_000 }, { day: "2026-11-20", purpose: "kunde", calls: 3, costMilliCents: 700 }, { day: "2026-11-20", purpose: "kontakt_aus_gespraech", calls: 2, costMilliCents: 500 },
      { day: "2026-11-20", purpose: "vorschlaege", calls: 40, costMilliCents: 104_400 }, { day: "2026-11-19", purpose: "webseite", calls: 10, costMilliCents: 9_000 }, { day: "2026-11-14", purpose: "ganz_neu", calls: 1, costMilliCents: 1_499 },
      { day: "2026-10-01", purpose: "vorschlaege", calls: 99, costMilliCents: 999_999 }, // außerhalb der 30 Tage
    ], "2026-11-20", 30);
    expect(history.days).toHaveLength(30); expect(history.days[0].day).toBe("2026-10-22"); expect(history.days[29].day).toBe("2026-11-20");
    const today = history.days[29]; expect(today).toMatchObject({ cents: 346, calls: 70, areas: { gespraeche: 241, kampagnen: 104, firmen: 0, assistenten: 0, sonstiges: 0 } });
    expect(today.parts.map((part) => `${part.label}:${part.calls}:${part.cents}`)).toEqual(["Gespräche bewerten:25:240", "E-Mail-Entwürfe:40:104", "Kontakt aus dem Gespräch lesen:5:1"]); // „kunde“ und „kontakt_aus_gespraech“ zusammen
    expect(history.days[28]).toMatchObject({ cents: 9, areas: { firmen: 9 } }); expect(history.days[27]).toMatchObject({ cents: 0, calls: 0, parts: [] });
    expect(history).toMatchObject({ totalCents: 356, weekCents: 356, totalCalls: 81, maxCents: 346, areas: { gespraeche: 241, kampagnen: 104, firmen: 9, sonstiges: 1 } });
    expect(purposeInfo("ganz_neu")).toEqual({ label: "Ganz neu", area: "sonstiges" }); expect(purposeInfo("vorschlaege").label).toBe("E-Mail-Entwürfe");
    expect([0, 80, 100, 101, 346, 1500, 1501, 7300].map(niceCeilCents)).toEqual([100, 100, 100, 200, 500, 2000, 2000, 10000]);
  });
});
