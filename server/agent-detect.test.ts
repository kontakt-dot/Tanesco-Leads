import { describe, expect, it } from "vitest";
import { agentNameMerges, canonicalAgentName, detectAgent, isJunkAgentName, sameAgentName } from "../shared/agent-names";

const name = (text: string, known: string[] = []) => detectAgent(text, known)?.name ?? null;

describe("Agent aus dem Transkript erkennen", () => {
  it.each([
    ["Guten Tag, hier ist Maja Becker von HausKompass. Spreche ich mit Herrn Müller?", "Maja Becker"],
    ["Schönen guten Tag, mein Name ist Vanessa Schiffer, ich rufe an von der Firma Haus Campus.", "Vanessa Schiffer"],
    ["Ja hallo? Guten Tag Herr Schmidt, Sabine Hagen am Apparat von HausKompass.", "Sabine Hagen"],
    ["Müller. Hallo Herr Müller, David Pfeil hier von HausKompass, Sie hatten sich informiert.", "David Pfeil"],
    ["Ja bitte? Guten Tag, Monika Hansen von der Firma HausKompass, ich rufe an wegen Photovoltaik.", "Monika Hansen"],
    ["Hallo, hier spricht die Frau Hansen von HausKompass.", "Hansen"],
    ["Guten Tag Herr Weber, Becker mein Name, ich melde mich von HausKompass.", "Becker"],
    ["Hallo? Ja guten Tag, ich bin Maja Becker und rufe von HausKompass an.", "Maja Becker"],
    ["Guten Tag, Sie sprechen mit Anna-Lena Kurz von HausKompass.", "Anna-Lena Kurz"],
  ])("„%s“ → %s", (text, expected) => { expect(name(text)).toBe(expected); });

  it("nimmt nicht den Kunden: Anrede und Aussagen des Kunden zählen nicht", () => {
    expect(name("Guten Tag Herr Müller von der Stadtwerke-Straße, hier ist Maja Becker von HausKompass.")).toBe("Maja Becker");
    expect(name("Kunde: Ja, ich bin Eigentümer. Agent: Sehr gut.")).toBeNull();
    expect(name("Ja hallo, ich bin gerade unterwegs.")).toBeNull();
    expect(name("Hier ist Maja Becker von HausKompass. Kunde: Ja, ich bin Peter Lange, was gibt es?")).toBe("Maja Becker"); // die erste eindeutige Vorstellung zählt
  });

  it("findet einen bekannten Agenten auch ohne Formel und verhört geschrieben", () => {
    expect(name("Ja hallo. Guten Tag, Maja Decker, es geht um Ihre Anfrage zur Photovoltaik.", ["Maja Becker", "David Pfeil"])).toBe("Maja Becker");
    expect(name("Guten Tag, es geht um Ihre Anfrage.", ["Maja Becker"])).toBeNull();
  });

  it("eine Vermutung ohne Firma und ohne klare Formel ist nicht „sicher“ – ein einzelnes Wort zählt dann gar nicht", () => {
    expect(detectAgent("Hallo, hier ist Becker.")).toBeNull();
    expect(detectAgent("Hallo, hier ist Maja Becker.")).toMatchObject({ name: "Maja Becker", sure: false });
    expect(detectAgent("Guten Tag, hier ist Maja Becker von HausKompass.")).toMatchObject({ sure: true });
    expect(detectAgent("Hallo, mein Name ist Maja Becker.")).toMatchObject({ name: "Maja Becker", sure: true });
  });

  it("der Kunde meldet sich zuerst mit Namen – der Agent ist trotzdem der, der sich mit Firma oder klarer Formel vorstellt", () => {
    expect(name("Ja, hier ist Peter Lange, hallo? Guten Tag Herr Lange, mein Name ist Maja Becker, ich rufe an wegen Ihrer Anfrage.")).toBe("Maja Becker");
    expect(name("Hier ist Peter Lange. Guten Tag Herr Lange, es geht um Ihre Anfrage zur Photovoltaik.")).toBeNull(); // nur der Kunde nennt seinen Namen
    expect(name("Lange hier. Hallo Herr Lange, Sabine Hagen von HausKompass.")).toBe("Sabine Hagen");
  });

  it("Familie, Berufe und Füllwörter sind keine Agenten-Namen", () => {
    for (const text of ["Ja, hier ist der Sohn, mein Vater ist gerade nicht da.", "Ich bin Rentner und Eigentümer.", "Mein Name ist Programm.".replace("Programm", "Name"), "Hier ist die Zentrale.", "Ich bin Mieterin, das entscheidet der Vermieter."]) expect(name(text)).toBeNull();
  });

  it("„Mein Name“ und andere Füllwörter gelten nie als bekannter Agent", () => {
    expect(isJunkAgentName("Mein Name")).toBe(true); expect(isJunkAgentName("Woche")).toBe(true); expect(isJunkAgentName("")).toBe(true); expect(isJunkAgentName(null)).toBe(true);
    expect(isJunkAgentName("Maja Becker")).toBe(false); expect(isJunkAgentName("Agent 12")).toBe(false); expect(isJunkAgentName("maja.becker")).toBe(false);
    // Stand ein solcher Eintrag schon in der Liste, wird er nicht mehr in fremden Gesprächen „wiedererkannt“
    expect(name("Guten Tag. Mein Name ist leider nicht zu verstehen gewesen.", ["Mein Name", "Maja Becker"])).toBeNull();
    expect(canonicalAgentName("Vanessa Schiffer", [{ name: "Mein Name", count: 50 }])).toBe("Vanessa Schiffer");
    expect(agentNameMerges([{ name: "Mein Name", count: 9 }, { name: "Maja Becker", count: 2 }])).toEqual([]);
  });

  it("ein bekannter Agent gewinnt gegen einen früheren, unsicheren Fund", () => {
    expect(detectAgent("Hallo, hier ist Peter Lange. Ja guten Tag, ich bin Maja Decker, es geht um Ihre Anfrage.", ["Maja Becker"])).toMatchObject({ name: "Maja Decker", sure: true });
  });
});

describe("Zuordnen: Teil-Namen und verhörte Namen", () => {
  const known = [{ name: "Maja Becker", count: 6 }, { name: "Vanessa Schiffer", count: 3 }, { name: "Monika Hansen", count: 3 }, { name: "David Pfeil", count: 2 }];
  it("nur Nachname → der Agent mit diesem Nachnamen", () => { expect(canonicalAgentName("Hansen", known)).toBe("Monika Hansen"); expect(canonicalAgentName("Schiffer", known)).toBe("Vanessa Schiffer"); expect(sameAgentName("Becker", "Maja Becker")).toBe(true); });
  it("nur Vorname → nur wenn genau ein Agent so heißt", () => { expect(canonicalAgentName("Vanessa", known)).toBe("Vanessa Schiffer"); expect(canonicalAgentName("Maja", [...known, { name: "Maja Sommer", count: 1 }])).toBe("Maja"); });
  it("gleicher Nachname und verhörte Namen", () => { expect(canonicalAgentName("Nesta Schiffer", known)).toBe("Vanessa Schiffer"); expect(canonicalAgentName("Maja Decker", known)).toBe("Maja Becker"); expect(canonicalAgentName("Peter Lange", known)).toBe("Peter Lange"); });
  it("beim Zusammenführen gewinnt der volle Name – auch wenn das Einzelwort öfter vorkommt", () => {
    expect(agentNameMerges([{ name: "Becker", count: 9 }, { name: "Maja Becker", count: 2 }, { name: "Sabine Hagen", count: 1 }])).toEqual([{ from: "Becker", to: "Maja Becker" }]);
  });
});
