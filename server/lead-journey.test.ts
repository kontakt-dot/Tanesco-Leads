import { describe, expect, it } from "vitest";
import { leadJourney, leadMoney, shortStamp, sinceText } from "../shared/lead-journey";
import { formatPhone } from "../shared/lead-age";

/** Version 367 – Lead-Seite: Weg des Leads in vier Schritten und was er gebracht hat */
const NOW = new Date(2026, 10, 25, 22, 10, 0);
const created = new Date(2026, 10, 21, 18, 13, 0);
const base = { status: "zugewiesen", createdAt: created, supplierName: "Beispiel Ads", call: null, deliveries: [], claims: [] };
const sale = (extra: Record<string, unknown> = {}) => ({ buyerName: "Muster Solar", result: "angenommen", unitPrice: "55.00", occurredAt: new Date(2026, 10, 21, 18, 38), inWindow: false, windowEndsAt: null, ...extra });
const titles = (steps: ReturnType<typeof leadJourney>) => steps.map((step) => `${step.title}:${step.state}`);

describe("Weg des Leads (v367)", () => {
  it("frisch angekommen und noch nicht geprüft", () => {
    const steps = leadJourney({ ...base, status: "neu" }, NOW);
    expect(titles(steps)).toEqual(["Eingegangen:done", "Wird geprüft:current", "Ausliefern:todo", "Nach dem Verkauf:todo"]);
    expect(steps[0].detail).toBe("21.11., 18:13 · von Beispiel Ads");
  });

  it("freigegeben (mit Gespräch) und bereit; ausgeliefert im Reklamationsfenster; fest verkauft", () => {
    const ready = leadJourney({ ...base, status: "genehmigt", call: { decision: "freigegeben", score: 88, at: created } }, NOW);
    expect(titles(ready)).toEqual(["Eingegangen:done", "Geprüft:done", "Bereit zum Ausliefern:current", "Nach dem Verkauf:todo"]); expect(ready[1].detail).toBe("Gespräch 88 von 100 Punkten");
    const inWindow = leadJourney({ ...base, deliveries: [sale({ inWindow: true, windowEndsAt: new Date(2026, 10, 26, 18, 38) })] }, NOW);
    expect(titles(inWindow)).toEqual(["Eingegangen:done", "Geprüft:done", "Ausgeliefert:done", "Reklamationsfenster:current"]);
    expect(inWindow[2].detail).toBe("an Muster Solar · 21.11., 18:38"); expect(inWindow[3].detail).toBe("bis 26.11., 18:38 · noch 21 Std.");
    // 5 Tage Fenster (21.11., 18:38 bis 26.11., 18:38), davon 4 Tage und 3 Std. 32 Min. um
    expect(inWindow[3].progress).toBeCloseTo((4 * 24 * 60 + 3 * 60 + 32) / (5 * 24 * 60), 5); expect(leadJourney({ ...base, deliveries: [sale()] }, NOW)[3].progress).toBeUndefined();
    expect(titles(leadJourney({ ...base, deliveries: [sale()] }, NOW))[3]).toBe("Fest verkauft:done");
  });

  it("Prüfung: zur Prüfung, zurückgewiesen, hängend, fehlerhaft, deaktiviert", () => {
    expect(titles(leadJourney({ ...base, status: "neu", call: { decision: "pruefen", score: 55, at: created } }, NOW))[1]).toBe("Zur Prüfung:warn");
    expect(titles(leadJourney({ ...base, status: "fehlerhaft", call: { decision: "zurueckgewiesen", score: 12, at: created } }, NOW))[1]).toBe("Fehlerhaft:fail");
    expect(titles(leadJourney({ ...base, status: "neu", call: { decision: "zurueckgewiesen", score: 12, at: created } }, NOW))[1]).toBe("Zurückgewiesen:fail");
    expect(titles(leadJourney({ ...base, status: "hängend" }, NOW)).slice(1, 3)).toEqual(["Geprüft:done", "Hängend:warn"]);
    expect(titles(leadJourney({ ...base, status: "deaktiviert" }, NOW))[1]).toBe("Deaktiviert:fail");
  });

  it("schon ausgeliefert, obwohl noch „neu“; im Gespräch freigegeben; mehrere Käufer; zugewiesen oder reklamiert ohne Einträge", () => {
    expect(leadJourney({ ...base, status: "neu", deliveries: [sale()] }, NOW)[1]).toMatchObject({ title: "Geprüft", detail: "direkt ausgeliefert", state: "done" });
    expect(leadJourney({ ...base, status: "neu", call: { decision: "freigegeben", score: 84, at: created } }, NOW)[1]).toMatchObject({ title: "Geprüft", detail: "Gespräch 84 von 100 Punkten", state: "done" });
    expect(leadJourney({ ...base, deliveries: [sale(), sale({ buyerName: "Zweiter Käufer", result: "angeboten" })] }, NOW)[2].detail).toBe("an Muster Solar +1 · 21.11., 18:38");
    // nur angeboten: wartet auf Übergabe – noch nicht fest verkauft
    expect(leadJourney({ ...base, deliveries: [sale({ result: "angeboten" })] }, NOW).slice(2)).toMatchObject([{ title: "Angeboten", detail: "an Muster Solar · wartet auf Übergabe", state: "current" }, { title: "Nach dem Verkauf", state: "todo" }]);
    // zweimal an denselben Käufer: kein „+1“; das Reklamationsfenster der älteren Auslieferung läuft noch
    const twice = leadJourney({ ...base, deliveries: [sale(), sale({ occurredAt: new Date(2026, 10, 20, 9, 0), inWindow: true, windowEndsAt: new Date(2026, 10, 27, 9, 0) })] }, NOW);
    expect(twice[2].detail).toBe("an Muster Solar · 21.11., 18:38"); expect(twice[3]).toMatchObject({ title: "Reklamationsfenster", state: "current", detail: "bis 27.11., 09:00 · noch 35 Std." });
    expect(titles(leadJourney({ ...base, status: "zugewiesen" }, NOW)).slice(2)).toEqual(["Zugewiesen:done", "Nach dem Verkauf:todo"]);
    expect(titles(leadJourney({ ...base, status: "reklamiert" }, NOW))[3]).toBe("Reklamiert:fail");
    expect(leadJourney({ ...base, status: "deaktiviert" }, NOW)[2].detail).toBe("entfällt");
  });

  it("abgelehnt beim Käufer; Reklamation offen, genehmigt oder abgelehnt", () => {
    const refused = leadJourney({ ...base, status: "genehmigt", deliveries: [sale({ result: "abgelehnt", skipReason: "PLZ außerhalb" })] }, NOW);
    expect(refused[2]).toMatchObject({ title: "Abgelehnt", state: "fail", detail: "Muster Solar: PLZ außerhalb" });
    const claim = (status: string) => ({ reason: "Falsche Kontaktdaten", status, refundAmount: "42.00", createdAt: new Date(2026, 10, 22, 9, 0), dueAt: new Date(2026, 10, 29, 12, 0) });
    expect(leadJourney({ ...base, deliveries: [sale()], claims: [claim("offen")] }, NOW)[3]).toMatchObject({ title: "Reklamation offen", state: "warn", detail: "Falsche Kontaktdaten · Frist 29.11." });
    expect(leadJourney({ ...base, deliveries: [sale()], claims: [claim("genehmigt")] }, NOW)[3]).toMatchObject({ title: "Reklamiert", state: "fail", detail: "Falsche Kontaktdaten · 42,00 € erstattet" });
    expect(leadJourney({ ...base, deliveries: [sale()], claims: [claim("abgelehnt")] }, NOW)[3]).toMatchObject({ title: "Reklamation abgelehnt", state: "done" });
  });
});

describe("Was der Lead gebracht hat (v367)", () => {
  it("Einkauf, Verkauf (angenommen und angeboten), Erstattung nur genehmigt, Marge und Anteil", () => {
    const worth = leadMoney("24.00", [sale(), sale({ buyerName: "Zweiter Käufer", result: "angeboten", unitPrice: "30.00" }), sale({ result: "abgelehnt", unitPrice: "99.00" })], [{ reason: "x", status: "genehmigt", refundAmount: "20.00", createdAt: NOW }, { reason: "y", status: "offen", refundAmount: "50.00", createdAt: NOW }]);
    expect(worth).toEqual({ bought: 24, sold: 85, refunded: 20, margin: 41, buyers: 2, marginShare: 48 });
    expect(leadMoney(null, [], [])).toEqual({ bought: 0, sold: 0, refunded: 0, margin: 0, buyers: 0, marginShare: null });
    // ausgeliefert zum Preis 0,00 € (z. B. eine Bestellung ohne Preis): verkauft an 1 Käufer, Marge = minus Einkauf
    expect(leadMoney("24.00", [sale({ unitPrice: "0.00" })], [])).toEqual({ bought: 24, sold: 0, refunded: 0, margin: -24, buyers: 1, marginShare: null });
  });

  it("Rufnummer lesbar: Handy mit Lücke nach der Vorwahl, alles andere bleibt", () => {
    expect(formatPhone("+4915112340071")).toBe("+49 151 12340071"); expect(formatPhone("004917612345678")).toBe("+49 176 12345678"); expect(formatPhone("01511234567")).toBe("0151 1234567");
    expect(formatPhone("+49 151 1015838")).toBe("+49 151 1015838"); expect(formatPhone("+4930123456")).toBe("+4930123456"); expect(formatPhone("+436601142542")).toBe("+436601142542"); expect(formatPhone(null)).toBe("");
  });

  it("Zeitangaben", () => {
    expect(shortStamp(created)).toBe("21.11., 18:13"); expect(shortStamp(null)).toBe("–");
    expect(sinceText(new Date(NOW.getTime() - 30_000), NOW)).toBe("gerade eben"); expect(sinceText(new Date(NOW.getTime() - 25 * 60_000), NOW)).toBe("vor 25 Min.");
    expect(sinceText(new Date(NOW.getTime() - 5 * 3_600_000), NOW)).toBe("vor 5 Std."); expect(sinceText(created, NOW)).toBe("vor 4 Tagen"); expect(sinceText(new Date(NOW.getTime() - 26 * 3_600_000), NOW)).toBe("vor 1 Tag");
    expect(sinceText(new Date(2026, 8, 1, 10, 0), NOW)).toBe("am 01.09.2026");
  });
});
