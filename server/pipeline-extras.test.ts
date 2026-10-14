import { describe, expect, it } from "vitest";
import { buildIcs, dueBucket, fillMessage, followUpDue, groupByDue, messageValues, normalizePhone, normalizePipelineSettings, pickOwner, pipelineCsv, pipelineValueSummary, stageProbability, staleInfo, weekDays } from "../shared/pipeline-extras";
import { abVariantFor, advanceRecipient, DEFAULT_SEND_WINDOW, followUpTree, hasAbTest, nextSendSlot, resolveSendWindow, subjectFor, summarizeCampaign, validateTree, type EmailNode, type RecipientState } from "../shared/email-campaigns";
import { starterBlocks } from "../shared/email-design";
import { PIPELINE_STAGES } from "../shared/sales-pipeline";

const now = new Date(2026, 9, 12, 14, 0, 0); // Montag, 12.10.2026 14:00

describe("Wiedervorlagen: Fälligkeit", () => {
  it("sortiert in Überfällig / Heute / Morgen / Woche / Später", () => {
    expect(dueBucket(new Date(2026, 9, 11, 18), now)).toBe("ueberfaellig");
    expect(dueBucket(new Date(2026, 9, 12, 9), now)).toBe("heute"); // Uhrzeit vorbei, aber heute
    expect(dueBucket(new Date(2026, 9, 12, 17), now)).toBe("heute");
    expect(dueBucket(new Date(2026, 9, 13, 9), now)).toBe("morgen");
    expect(dueBucket(new Date(2026, 9, 16, 9), now)).toBe("woche");
    expect(dueBucket(new Date(2026, 10, 2, 9), now)).toBe("spaeter");
    const groups = groupByDue([{ dueAt: new Date(2026, 9, 13, 9), id: 1 }, { dueAt: new Date(2026, 9, 11, 9), id: 2 }, { dueAt: new Date(2026, 9, 12, 16), id: 3 }], now);
    expect(groups.ueberfaellig.map((item) => item.id)).toEqual([2]); expect(groups.heute.map((item) => item.id)).toEqual([3]); expect(groups.morgen.map((item) => item.id)).toEqual([1]);
  });
  it("legt Dialer-Wiedervorlagen nie in die Nacht oder ans Wochenende", () => {
    const evening = followUpDue(new Date(2026, 9, 16, 18, 30), 120); // Freitag 18:30 + 2 h → Montag 9:00
    expect(evening.getDay()).toBe(1); expect(evening.getHours()).toBe(9);
    const sameDay = followUpDue(new Date(2026, 9, 12, 10, 0), 240); expect(sameDay.getHours()).toBe(14);
  });
});

describe("Eingeschlafene Karten & Lead-Punkte", () => {
  it("erkennt eingeschlafene Karten nur in offenen Stufen", () => {
    const old = new Date(2026, 9, 1);
    expect(staleInfo({ pipelineStage: "angebot", pipelineUpdatedAt: old, createdAt: old }, now, 5, PIPELINE_STAGES)).toMatchObject({ stale: true, days: 11 });
    expect(staleInfo({ pipelineStage: "kunde", pipelineUpdatedAt: old, createdAt: old }, now, 5, PIPELINE_STAGES).stale).toBe(false);
    expect(staleInfo({ pipelineStage: "angebot", pipelineUpdatedAt: old, createdAt: old, lastActivityAt: new Date(2026, 9, 11) }, now, 5, PIPELINE_STAGES).stale).toBe(false); // Notiz gestern zählt als Bewegung
    expect(staleInfo({ pipelineStage: "angebot", pipelineUpdatedAt: old, createdAt: old }, now, 0, PIPELINE_STAGES).stale).toBe(false); // 0 = aus
  });
});

describe("Angebotswerte & Umsatz", () => {
  it("rechnet Pipeline-Wert, Gewichtung, Abschlussquote in Euro und Umsatz je Vertriebler", () => {
    expect(stageProbability("neu", PIPELINE_STAGES)).toBe(10); expect(stageProbability("angebot", PIPELINE_STAGES)).toBe(90); expect(stageProbability("kunde", PIPELINE_STAGES)).toBe(100); expect(stageProbability("verloren", PIPELINE_STAGES)).toBe(0);
    const summary = pipelineValueSummary([{ pipelineStage: "angebot", dealValue: 10000, ownerUserId: 1, ownerName: "Taner Test" }, { pipelineStage: "neu", dealValue: 2000, ownerUserId: 2, ownerName: "Francesco" }, { pipelineStage: "kunde", dealValue: 30000, ownerUserId: 1, ownerName: "Taner Test" }, { pipelineStage: "verloren", dealValue: 10000, ownerUserId: 2, ownerName: "Francesco" }], PIPELINE_STAGES);
    expect(summary.openValue).toBe(12000); expect(summary.weighted).toBe(9200); expect(summary.wonValue).toBe(30000); expect(summary.closeRateEuro).toBe(75); expect(summary.closeRate).toBe(50);
    expect(summary.byOwner[0]).toMatchObject({ ownerName: "Taner", wonValue: 30000, openValue: 10000 });
  });
  it("exportiert die Pipeline als CSV mit deutschen Spalten", () => {
    const csv = pipelineCsv([{ publicId: "META-1", name: "Max; Muster", company: "Muster GmbH", email: "max@beispiel.de", phone: "+49 160 1", postcode: "60311", city: "Frankfurt", categoryName: "Photovoltaik", pipelineStage: "angebot", ownerName: "Taner", adCampaignName: "PV Herbst", adPlatform: "facebook", createdAt: now, pipelineUpdatedAt: now, dealValue: 12500.5, followUpAt: null, appointmentAt: null, latestNote: "Angebot verschickt\nRückruf" }], PIPELINE_STAGES);
    const lines = csv.split("\n"); expect(lines[0]).toContain("Lead-ID;Name;Firma"); expect(lines[1]).toContain("\"Max; Muster\""); expect(lines[1]).toContain("Angebot;Taner;Meta Ads;PV Herbst"); expect(lines[1]).toContain("12500,5"); expect(lines[1]).toContain("Angebot verschickt Rückruf");
  });
});

describe("Verteilregeln & Einstellungen", () => {
  it("bereinigt Einstellungen und wählt den Vertriebler nach Region, Kategorie und Auslastung", () => {
    const settings = normalizePipelineSettings({ staleDays: "7", staleCampaignId: 3, stageCampaigns: { angebot: 4, leer: "x" }, dispositionCampaigns: { interessiert: 4 }, replyStage: "kontaktiert", appointmentReminder: "sms", appointmentReminderHours: 48, distribution: { mode: "regeln", rules: [{ id: "r1", userId: 1, postcodePrefixes: ["6", "5x"], categoryIds: [2], maxOpen: 2 }, { id: "r2", userId: 2, postcodePrefixes: ["8"], categoryIds: [], maxOpen: null }], fallback: "ohne" }, dailyTargets: { "1": { calls: 40, appointments: 2, deals: "1" } } });
    expect(settings).toMatchObject({ staleDays: 7, staleCampaignId: 3, stageCampaigns: { angebot: 4 }, appointmentReminder: "sms", appointmentReminderHours: 48 }); expect(settings.distribution.rules[0].postcodePrefixes).toEqual(["6", "5"]); expect(settings.dailyTargets["1"]).toEqual({ calls: 40, appointments: 2, deals: 1 });
    const candidates = [{ userId: 1, openCount: 0 }, { userId: 2, openCount: 10 }];
    expect(pickOwner(settings.distribution, { postcode: "60311", categoryId: 2 }, candidates, 0)).toMatchObject({ userId: 1 });
    expect(pickOwner(settings.distribution, { postcode: "60311", categoryId: 9 }, candidates, 0)).toMatchObject({ userId: null, reason: "keine Regel passt" }); // Kategorie passt nicht, Fallback „ohne“
    expect(pickOwner(settings.distribution, { postcode: "80331", categoryId: 9 }, candidates, 0)).toMatchObject({ userId: 2 });
    expect(pickOwner(settings.distribution, { postcode: "60311", categoryId: 2 }, [{ userId: 1, openCount: 2 }, { userId: 2, openCount: 0 }], 0).userId).toBeNull(); // Limit erreicht
    expect(pickOwner({ mode: "reihum", rules: [], fallback: "reihum" }, {}, candidates, 3)).toMatchObject({ userId: 2, reason: "reihum" });
    expect(pickOwner({ mode: "aus", rules: [], fallback: "reihum" }, {}, candidates, 0).userId).toBeNull();
  });
});

describe("Termine & Nachrichten", () => {
  it("baut einen Kalendereintrag (ICS) und füllt Nachrichten-Vorlagen", () => {
    const ics = buildIcs({ uid: "META-1-1@tanesco", start: new Date(Date.UTC(2026, 9, 14, 8, 0)), durationMinutes: 60, title: "Termin mit Tanesco", description: "Vor-Ort, Dach prüfen", location: "Frankfurt", attendeeEmail: "max@beispiel.de", attendeeName: "Max Muster" });
    expect(ics).toContain("BEGIN:VCALENDAR"); expect(ics).toContain("DTSTART:20261014T080000Z"); expect(ics).toContain("DTEND:20261014T090000Z"); expect(ics).toContain("DESCRIPTION:Vor-Ort\\, Dach prüfen"); expect(ics).toContain("ATTENDEE;CN=Max Muster;RSVP=TRUE:mailto:max@beispiel.de");
    const values = messageValues({ firstName: "Max", lastName: "Muster", company: "Muster GmbH", categoryName: "Photovoltaik", appointmentAt: new Date(2026, 9, 14, 10, 0), metadata: { salutation: "herr" } }, "Taner Yildiz");
    expect(fillMessage("Guten Tag {{anrede}} {{nachname}}, Termin am {{termin}} – {{absender}}", values)).toBe("Guten Tag Herr Muster, Termin am Mi., 14.10.2026, 10:00 – Taner");
    expect(fillMessage("Hallo {{anrede}} {{nachname}}!", { ...values, anrede: "" })).toBe("Hallo Muster!");
    expect(weekDays(new Date(2026, 9, 14))[0].getDay()).toBe(1); expect(weekDays(new Date(2026, 9, 14))[6].getDay()).toBe(0);
  });
  it("bringt Telefonnummern ins E.164-Format", () => {
    expect(normalizePhone("0160 123 45 67")).toBe("+491601234567"); expect(normalizePhone("+49 (69) 555-0101")).toBe("+49695550101"); expect(normalizePhone("0049 89 1234567")).toBe("+49891234567"); expect(normalizePhone("")).toBeNull(); expect(normalizePhone("123")).toBeNull();
  });
});

describe("E-Mail-Kampagnen: A/B-Test, Versandfenster, Link-Bedingung, Sperrliste", () => {
  it("teilt Empfänger in Varianten auf und nimmt je Variante den passenden Betreff", () => {
    const variants = Array.from({ length: 10 }, (_, index) => abVariantFor(index, 50)); expect(variants.filter((variant) => variant === "B").length).toBe(5); expect(variants[0]).toBe("A");
    expect(Array.from({ length: 10 }, (_, index) => abVariantFor(index, 30)).filter((variant) => variant === "B").length).toBe(3);
    const node: Extract<EmailNode, { type: "send" }> = { id: "s1", type: "send", subject: "A-Betreff", subjectB: "B-Betreff", blocks: starterBlocks("kaltakquise"), next: null };
    expect(subjectFor(node, "B")).toBe("B-Betreff"); expect(subjectFor(node, "A")).toBe("A-Betreff"); expect(subjectFor({ ...node, subjectB: null }, "B")).toBe("A-Betreff");
    expect(hasAbTest({ start: "s1", nodes: [node] })).toBe(true); expect(hasAbTest({ start: "s1", nodes: [{ ...node, subjectB: "" }] })).toBe(false);
    const stats = summarizeCampaign([{ status: "fertig", sentCount: 1, openedAt: now, clickedAt: null, repliedAt: null, variant: "A" }, { status: "fertig", sentCount: 1, openedAt: null, clickedAt: null, repliedAt: null, variant: "B" }, { status: "bounce", sentCount: 1, openedAt: null, clickedAt: null, repliedAt: null, variant: "B" }]);
    expect(stats.abTest).toMatchObject({ winner: "A" }); expect(stats.abTest?.a.openRate).toBe(100); expect(stats.bounced).toBe(1); expect(stats.bounceRate).toBe(33);
  });
  it("Standard-Versandfenster: werktags 7:30–17:00 Uhr Berlin, eingeschaltet; ältere Kampagnen ohne Fenster senden rund um die Uhr", () => {
    expect(DEFAULT_SEND_WINDOW).toEqual({ enabled: true, weekdays: [1, 2, 3, 4, 5], from: "07:30", to: "17:00", timezone: "Europe/Berlin" });
    expect(nextSendSlot(new Date(Date.UTC(2026, 9, 13, 5, 0)), DEFAULT_SEND_WINDOW)?.toISOString()).toBe("2026-10-13T05:30:00.000Z"); // Dienstag 7:00 Berlin → 7:30
    expect(nextSendSlot(new Date(Date.UTC(2026, 9, 13, 15, 30)), DEFAULT_SEND_WINDOW)?.toISOString()).toBe("2026-10-14T05:30:00.000Z"); // Dienstag 17:30 Berlin → Mittwoch 7:30
    expect(nextSendSlot(new Date(Date.UTC(2026, 9, 16, 15, 30)), DEFAULT_SEND_WINDOW)?.toISOString()).toBe("2026-10-19T05:30:00.000Z"); // Freitag 17:30 → Montag 7:30
    expect(nextSendSlot(new Date(Date.UTC(2026, 9, 13, 8, 0)), DEFAULT_SEND_WINDOW)).toBeNull(); // Dienstag 10:00 Berlin → sofort
    expect(resolveSendWindow(null)).toMatchObject({ enabled: false, from: "07:30", to: "17:00" });
    expect(resolveSendWindow({ enabled: true, from: "09:00" })).toMatchObject({ enabled: true, from: "09:00", to: "17:00", weekdays: [1, 2, 3, 4, 5] });
    expect(resolveSendWindow({ enabled: false })).toMatchObject({ enabled: false });
  });
  it("hält das Versandfenster ein (Zeitzone, Wochentage) und wartet sonst bis zum nächsten Fenster", async () => {
    const window = { enabled: true, weekdays: [1, 2, 3, 4, 5], from: "08:30", to: "18:00", timezone: "Europe/Berlin" };
    const saturdayNight = new Date(Date.UTC(2026, 9, 17, 20, 0)); // Samstag 22:00 Berlin
    const slot = nextSendSlot(saturdayNight, window)!; expect(slot).toBeInstanceOf(Date); expect(slot.getUTCDay()).toBe(1); expect(slot.toISOString()).toBe("2026-10-19T06:30:00.000Z"); // Montag 8:30 Berlin (Sommerzeit)
    expect(nextSendSlot(new Date(Date.UTC(2026, 9, 12, 10, 0)), window)).toBeNull(); // Montag 12:00 Berlin → sofort
    expect(nextSendSlot(saturdayNight, { ...window, enabled: false })).toBeNull();
    const sends: string[] = [];
    const state: RecipientState = { nodeId: "s1", nextActionAt: null, status: "wartet", sentCount: 0, openedAt: null, clickedAt: null, repliedAt: null, lastSentAt: null, variant: "B" };
    const result = await advanceRecipient({ start: "s1", nodes: [{ id: "s1", type: "send", subject: "A", subjectB: "B", blocks: starterBlocks("kaltakquise"), next: null }] }, state, saturdayNight, async (_node, subject) => { sends.push(subject); return true; }, { window });
    expect(sends).toEqual([]); expect(result.state.status).toBe("wartet"); expect(result.state.nextActionAt?.toISOString()).toBe("2026-10-19T06:30:00.000Z"); expect(result.events[0].note).toContain("Versandfenster");
    const sent = await advanceRecipient({ start: "s1", nodes: [{ id: "s1", type: "send", subject: "A", subjectB: "B", blocks: starterBlocks("kaltakquise"), next: null }] }, state, new Date(Date.UTC(2026, 9, 12, 10, 0)), async (_node, subject) => { sends.push(subject); return true; }, { window });
    expect(sends).toEqual(["B"]); expect(sent.events[0].note).toContain("Variante B");
  });
  it("verzweigt bei „Link X geklickt“ nur, wenn der passende Link geklickt wurde", async () => {
    const tree = { start: "c1", nodes: [{ id: "c1", type: "condition", check: "clicked", url: "/termin", yes: "e1", no: "e2" }, { id: "e1", type: "end", label: "Termin-Link" }, { id: "e2", type: "end", label: "Kein Termin-Link" }] as EmailNode[] };
    const base: RecipientState = { nodeId: "c1", nextActionAt: null, status: "laeuft", sentCount: 1, openedAt: now, clickedAt: now, repliedAt: null, lastSentAt: new Date(now.getTime() - 60_000) };
    const hit = await advanceRecipient(tree, { ...base, clickedUrls: ["https://tanesco.digital/termin"] }, now, async () => true); expect(hit.events[0].note).toContain("ja → Dann-Zweig"); expect(hit.events[1].note).toBe("Termin-Link");
    const miss = await advanceRecipient(tree, { ...base, clickedUrls: ["https://tanesco.digital/preise"] }, now, async () => true); expect(miss.events[0].note).toContain("nein → Sonst-Zweig");
    const any = await advanceRecipient({ ...tree, nodes: tree.nodes.map((node) => node.type === "condition" ? { ...node, url: null } : node) }, { ...base, clickedUrls: ["https://tanesco.digital/preise"] }, now, async () => true); expect(any.events[0].note).toContain("ja → Dann-Zweig");
  });
  it("liefert eine Nachfass-Serie, die bei Antwort endet", () => {
    const tree = followUpTree({ first: starterBlocks("angebot"), second: starterBlocks("nachfassen") });
    expect(validateTree(tree)).toEqual([]); expect(tree.nodes.filter((node) => node.type === "send").length).toBe(2); expect(tree.nodes.find((node) => node.type === "condition")).toMatchObject({ check: "replied" });
  });
});
