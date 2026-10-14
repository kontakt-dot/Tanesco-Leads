import { describe, expect, it } from "vitest";
import { effectiveAutoNotes, formatCallNote, heuristicCallSummary, parseTranscript } from "../shared/call-notes";

describe("Automatische Gesprächsnotizen", () => {
  const transcript = "Agent: Guten Tag, hier Taner von Tanesco. Hätten Sie kurz Zeit?\nKunde: Ja, kurz. Wir suchen gerade neue Aufträge für Photovoltaik, aber der Preis pro Anfrage ist mir wichtig.\nAgent: Verstanden, Sie zahlen nur für gelieferte Leads.\nKunde: Schicken Sie mir ein Angebot per E-Mail, wir entscheiden nächste Woche.";

  it("schaltet nach Kampagne vor Einstellung", () => {
    expect(effectiveAutoNotes(true, null)).toBe(true);
    expect(effectiveAutoNotes(false, null)).toBe(false);
    expect(effectiveAutoNotes(false, true)).toBe(true);
    expect(effectiveAutoNotes(true, false)).toBe(false);
    expect(effectiveAutoNotes(undefined, undefined)).toBe(true);
  });

  it("zerlegt Transkripte in Sprecher", () => {
    const turns = parseTranscript(transcript);
    expect(turns.map((turn) => turn.speaker)).toEqual(["agent", "kunde", "agent", "kunde"]);
    expect(parseTranscript("Sprecher 2: Hallo\nB: Test\nA: Ja")[0].speaker).toBe("kunde");
    expect(parseTranscript("Sprecher 2: Hallo\nB: Test\nA: Ja")[2].speaker).toBe("agent");
  });

  it("fasst ohne KI die Kundenaussagen und erkannte Fakten zusammen", () => {
    const summary = heuristicCallSummary(transcript);
    expect(summary.source).toBe("kurzfassung");
    expect(summary.summary.startsWith("Kunde: ")).toBe(true);
    expect(summary.summary).toContain("Preis pro Anfrage");
    expect(summary.points).toContain("Angebot gewünscht");
    expect(summary.points).toContain("Unterlagen per E-Mail gewünscht");
    expect(summary.points).toContain("Rückruf gewünscht"); // „nächste Woche“
    expect(summary.nextStep).toBe("Wiedervorlage anlegen und zurückrufen.");
    const no = heuristicCallSummary("Agent: Hallo?\nKunde: Nein danke, kein Interesse.");
    expect(no.points).toContain("Kein Interesse geäußert");
    expect(no.nextStep).toContain("Kein weiterer Kontakt");
  });

  it("baut den Notiztext mit Kopfzeile, Punkten, Ergebnis und Quelle", () => {
    const text = formatCallNote({ startedAt: new Date("2026-10-11T09:30:00"), talkSeconds: 212, agentName: "Taner Demir", campaignName: "Kaltakquise: Dachdecker Hessen", mode: "power", statusLabel: "Beendet", dispositionLabel: "Interessiert – Angebot gewünscht", agentNotes: "Entscheider ist der Inhaber." }, heuristicCallSummary(transcript));
    expect(text.split("\n")[0]).toMatch(/^📞 Gesprächsnotiz \(automatisch\) – 11\.10\.2026, 09:30 · 3:32 Min\. · Agent Taner · Kaltakquise: Dachdecker Hessen$/);
    expect(text).toContain("• Angebot gewünscht");
    expect(text).toContain("Nächster Schritt: Wiedervorlage anlegen und zurückrufen.");
    expect(text).toContain("Ergebnis: Interessiert – Angebot gewünscht");
    expect(text).toContain("Notiz des Agenten: Entscheider ist der Inhaber.");
    expect(text).toContain("Kurzfassung aus dem Transkript (ohne KI-Schlüssel).");
    const bare = formatCallNote({ startedAt: null, talkSeconds: 40, agentName: null, campaignName: null, mode: "manuell", statusLabel: "Beendet", dispositionLabel: "Wiedervorlage", agentNotes: null }, null);
    expect(bare).toContain("Kein Transkript vorhanden – Notiz aus den Anrufdaten.");
    expect(bare).toContain("Ergebnis: Wiedervorlage");
    expect(bare).not.toContain("Nächster Schritt");
  });
});
