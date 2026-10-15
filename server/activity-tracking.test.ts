import { describe, expect, it } from "vitest";
import { countSince, dayLabel, groupActivity, type ActivityEntry } from "../shared/activity";
import { countReactions, trackingForSend } from "../shared/sent-tracking";

const now = new Date(2026, 9, 15, 12, 0, 0); // Do, 15.10.2026 12:00
const at = (daysAgo: number, hour: number, minute = 0) => new Date(2026, 9, 15 - daysAgo, hour, minute, 0);
let seq = 0;
const entry = (kind: ActivityEntry["kind"], createdAt: Date, count = 1, extra: Partial<ActivityEntry> = {}): ActivityEntry => ({ id: ++seq, kind, title: `${kind} ${seq}`, detail: null, count, leadPublicId: null, actorName: null, createdAt, ...extra });

describe("Glocke: Tagesverlauf (shared/activity)", () => {
  it("bündelt Einträge je Tag und Art, neueste Tage zuerst, häufigste Arten zuerst", () => {
    const days = groupActivity([
      entry("anruf", at(0, 9)), entry("anruf", at(0, 10)), entry("kontakt_neu", at(0, 8), 120), entry("lead_verkauft", at(0, 11)),
      entry("anruf", at(1, 9)), entry("email_gesendet", at(1, 9, 30), 25),
      entry("lead_neu", at(3, 7)),
    ], now);
    expect(days.map((day) => day.label)).toEqual(["Heute", "Gestern", dayLabel("2026-10-12", now)]);
    expect(days[0].total).toBe(123); // 120 Kontakte + 2 Anrufe + 1 Verkauf
    expect(days[0].groups.map((group) => group.kind)).toEqual(["kontakt_neu", "anruf", "lead_verkauft"]);
    expect(days[0].summary).toBe("120 neue Kontakte · 2 Anrufe · 1 Lead verkauft");
    expect(days[1].groups.find((group) => group.kind === "email_gesendet")?.label).toBe("25 E-Mails gesendet");
    expect(days[1].groups.find((group) => group.kind === "anruf")?.label).toBe("1 Anruf");
  });

  it("fasst mehr als vier Arten mit „+ n weitere“ zusammen und sortiert Einträge innerhalb einer Art nach Zeit", () => {
    const days = groupActivity([
      entry("anruf", at(0, 9)), entry("kontakt_neu", at(0, 9)), entry("lead_verkauft", at(0, 9)), entry("bestellung", at(0, 9)), entry("reklamation", at(0, 9)), entry("email_antwort", at(0, 9)),
      entry("anruf", at(0, 11)),
    ], now);
    expect(days[0].summary.endsWith("· + 2 weitere")).toBe(true);
    const calls = days[0].groups.find((group) => group.kind === "anruf")!;
    expect(new Date(calls.entries[0].createdAt).getHours()).toBe(11);
  });

  it("zählt, was seit dem letzten Öffnen dazugekommen ist", () => {
    const entries = [entry("anruf", at(0, 9)), entry("anruf", at(0, 10)), entry("anruf", at(1, 9))];
    expect(countSince(entries, null)).toBe(3);
    expect(countSince(entries, at(0, 9, 30))).toBe(1);
    expect(countSince(entries, at(0, 12))).toBe(0);
  });
});

describe("Gesendet: Reaktion je Mail (shared/sent-tracking)", () => {
  const events = [
    { recipientId: 1, kind: "gesendet", createdAt: at(5, 9) },
    { recipientId: 1, kind: "geoeffnet", note: "E-Mail geöffnet", createdAt: at(4, 15) },
    { recipientId: 1, kind: "geklickt", note: "Link", createdAt: at(4, 16) },
    { recipientId: 1, kind: "gesendet", createdAt: at(2, 9) },
    { recipientId: 1, kind: "geoeffnet", note: "Antwort im Posteingang: „AW: Hallo“", createdAt: at(1, 9) },
  ];
  const sends = [at(5, 9), at(2, 9)];

  it("ordnet Öffnung und Klick der ersten Mail zu, die Antwort der zweiten", () => {
    const first = trackingForSend(at(5, 9), events, sends);
    expect(first.openedAt?.getTime()).toBe(at(4, 15).getTime());
    expect(first.clickedAt?.getTime()).toBe(at(4, 16).getTime());
    expect(first.repliedAt).toBeNull();
    expect(first.reaction).toBe("geklickt");
    const second = trackingForSend(at(2, 9), events, sends);
    expect(second.openedAt).toBeNull();
    expect(second.repliedAt?.getTime()).toBe(at(1, 9).getTime());
    expect(second.reaction).toBe("geantwortet");
  });

  it("nutzt die Zeitstempel des Empfängers als Rückfall und meldet ohne Ereignisse „ohne“", () => {
    const only = [{ recipientId: 2, kind: "gesendet", createdAt: at(3, 9) }];
    expect(trackingForSend(at(3, 9), only, [at(3, 9)]).reaction).toBe("ohne");
    expect(trackingForSend(at(3, 9), only, [at(3, 9)], { repliedAt: at(2, 10) }).reaction).toBe("geantwortet");
    expect(trackingForSend(at(3, 9), only, [at(3, 9)], { repliedAt: at(4, 10) }).reaction).toBe("ohne"); // Antwort vor dem Versand zählt nicht
    const stamps = trackingForSend(at(3, 9), only, [at(3, 9)], { openedAt: at(3, 10), clickedAt: at(3, 11) });
    expect(stamps.reaction).toBe("geklickt"); expect(stamps.openedAt?.getTime()).toBe(at(3, 10).getTime()); // Zeitstempel am Empfänger als Rückfall
  });

  it("Bounce schlägt alles, Abmeldung schlägt Klick; Zählung je Reaktion", () => {
    const bounced = trackingForSend(at(3, 9), [{ recipientId: 3, kind: "geoeffnet", createdAt: at(3, 10) }, { recipientId: 3, kind: "bounce", createdAt: at(3, 9, 1) }], [at(3, 9)]);
    expect(bounced.reaction).toBe("bounce");
    const unsubscribed = trackingForSend(at(3, 9), [{ recipientId: 4, kind: "geklickt", createdAt: at(3, 10) }, { recipientId: 4, kind: "abgemeldet", createdAt: at(3, 10, 1) }], [at(3, 9)]);
    expect(unsubscribed.reaction).toBe("abgemeldet");
    expect(countReactions([{ tracking: bounced }, { tracking: unsubscribed }, { tracking: null }])).toEqual({ bounce: 1, abgemeldet: 1, geantwortet: 0, geklickt: 0, geoeffnet: 0, ohne: 0 });
  });
});

describe("Signatur für Antworten (shared/email-signature)", () => {
  const sig = { enabled: true, greeting: "Mit freundlichen Grüßen", name: "Thomas Kutzbach", role: "", phone: "+49 (0) 178 33 59 146", email: "kontakt@tanescodigital.de", website: "www.tanescodigital.de", showLogo: true, showCompany: true };
  const context = { companyFooter: "Tanesco Digital GbR · Schultheißweg 44 · 55252 Wiesbaden", logoUrl: "https://app.example/brand/tanesco-logo-mail.png" };

  it("HTML: Grußformel, Name kursiv, Logo, Firmenblock in Zeilen, Telefon, E-Mail- und Webseiten-Link", async () => {
    const { renderSignatureHtml, renderSignatureText, companyLines, normalizeSignature } = await import("../shared/email-signature");
    const html = renderSignatureHtml(sig, context);
    expect(html).toContain("Mit freundlichen Grüßen"); expect(html).toContain("font-style:italic\">Thomas Kutzbach");
    expect(html).toContain('src="https://app.example/brand/tanesco-logo-mail.png"');
    expect(html).toContain("Tanesco Digital GbR"); expect(html).toContain("Schultheißweg 44"); expect(html).toContain("55252 Wiesbaden");
    expect(html).toContain("Telefon: +49 (0) 178 33 59 146"); expect(html).toContain('href="mailto:kontakt@tanescodigital.de"'); expect(html).toContain('href="https://www.tanescodigital.de"');
    expect(companyLines(context.companyFooter)).toEqual(["Tanesco Digital GbR", "Schultheißweg 44", "55252 Wiesbaden"]);
    const text = renderSignatureText(sig, context);
    expect(text.split("\n")).toEqual(["", "-- ", "Mit freundlichen Grüßen", "Thomas Kutzbach", "", "Tanesco Digital GbR", "Schultheißweg 44", "55252 Wiesbaden", "Telefon: +49 (0) 178 33 59 146", "E-Mail: kontakt@tanescodigital.de", "Webseite: www.tanescodigital.de"]);
    expect(normalizeSignature({ name: "  X  " }).greeting).toBe("Mit freundlichen Grüßen"); expect(normalizeSignature({ name: "  X  " }).name).toBe("X");
  });

  it("ausgeschaltet oder leer → keine Signatur; ohne Logo/Firma bleiben nur die Kontaktzeilen; HTML wird entschärft", async () => {
    const { renderSignatureHtml, renderSignatureText, checkAttachments } = await import("../shared/email-signature");
    expect(renderSignatureHtml({ ...sig, enabled: false }, context)).toBe(""); expect(renderSignatureText({ ...sig, enabled: false }, context)).toBe("");
    expect(renderSignatureHtml({ ...sig, greeting: "", name: "", phone: "", email: "", website: "", showCompany: false }, context)).toBe("");
    const slim = renderSignatureHtml({ ...sig, showLogo: false, showCompany: false }, context);
    expect(slim).not.toContain("<img"); expect(slim).not.toContain("Wiesbaden"); expect(slim).toContain("Telefon:");
    expect(renderSignatureHtml({ ...sig, name: "<b>Böse</b>" }, context)).toContain("&lt;b&gt;Böse&lt;/b&gt;");
    expect(checkAttachments([])).toBeNull();
    expect(checkAttachments(Array.from({ length: 6 }, (_, i) => ({ filename: `f${i}.pdf`, contentType: "application/pdf", contentBase64: "", size: 10 })))).toMatch(/Höchstens 5/);
    expect(checkAttachments([{ filename: "gross.pdf", contentType: "application/pdf", contentBase64: "", size: 8 * 1024 * 1024 }])).toMatch(/zu groß/);
    expect(checkAttachments([{ filename: "a.pdf", contentType: "", contentBase64: "", size: 6 * 1024 * 1024 }, { filename: "b.pdf", contentType: "", contentBase64: "", size: 6 * 1024 * 1024 }, { filename: "c.pdf", contentType: "", contentBase64: "", size: 6 * 1024 * 1024 }])).toMatch(/zusammen/);
  });
});
