import { describe, expect, it } from "vitest";
import { buildIcs, callCounterText, callResultOfDialer, CALL_RESULTS, dueBucket, fillMessage, followUpDue, groupByDue, leadScore, ownerSequence, splitShares, mailReactionOf, messageValues, normalizePhone, normalizePipelineSettings, normalizeSourceOrder, pickOwner, shareSequence, distributionActive, effectiveDistribution, pipelineCsv, pipelineValueSummary, stageProbability, staleInfo, temperatureOf, weekDays } from "../shared/pipeline-extras";
import { abVariantFor, advanceRecipient, DEFAULT_SEND_WINDOW, followUpTree, hasAbTest, moveNodeInTree, nextSendSlot, resolveSendWindow, subjectFor, summarizeCampaign, validateTree, windowForDay, type EmailNode, type RecipientState } from "../shared/email-campaigns";
import { companyFooterText, DEFAULT_DESIGN, linkifyFooter, renderEmailHtml } from "../shared/email-design";
import { starterBlocks } from "../shared/email-design";
import { contactedStage, PIPELINE_STAGES, workingStage } from "../shared/sales-pipeline";

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
    const lines = csv.split("\n"); expect(lines[0]).toContain("Lead-ID;Name;Firma"); expect(lines[1]).toContain("\"Max; Muster\""); expect(lines[0]).toContain("Stufe;Einschätzung;Punkte;Vertriebler"); expect(lines[1]).toContain("Angebot;;;Taner;Meta Ads;PV Herbst"); expect(lines[1]).toContain("12500,5"); expect(lines[1]).toContain("Angebot verschickt Rückruf");
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
    expect(pickOwner({ mode: "reihum", rules: [], fallback: "reihum", shares: [], perPipeline: {} }, {}, candidates, 3)).toMatchObject({ userId: 2, reason: "reihum" });
    expect(pickOwner({ mode: "aus", rules: [], fallback: "reihum", shares: [], perPipeline: {} }, {}, candidates, 0).userId).toBeNull();
  });
  it("verteilt nach Anteilen (50/50, 70/30) und je Pipeline anders – z. B. nur die Kaltakquise 50/50 an zwei Vertriebler", () => {
    const candidates = [{ userId: 1, openCount: 0 }, { userId: 2, openCount: 0 }, { userId: 3, openCount: 0 }];
    const halbe = normalizePipelineSettings({ distribution: { mode: "anteile", shares: [{ userId: 1, percent: 50 }, { userId: 2, percent: 50 }, { userId: 9, percent: "x" }], perPipeline: { kaltakquise: { mode: "standard", shares: [] }, email: { mode: "aus", shares: [] }, unsinn: { mode: "reihum" } } } }).distribution;
    expect(halbe.shares).toEqual([{ userId: 1, percent: 50 }, { userId: 2, percent: 50 }, { userId: 9, percent: 0 }]); expect(halbe.perPipeline).toEqual({ email: { mode: "aus", shares: [] } }); // „standard“ wird nicht gespeichert, unbekannte Pipeline fliegt raus
    expect(shareSequence([{ userId: 1, percent: 50 }, { userId: 2, percent: 50 }])).toEqual([1, 2]); expect(shareSequence([{ userId: 1, percent: 70 }, { userId: 2, percent: 30 }])).toEqual([1, 2, 1, 1, 2, 1, 1, 2, 1, 1]); // 7 von 10 an Vertriebler 1, gewichtet abwechselnd expect(shareSequence([{ userId: 1, percent: 100 }], new Set([2]))).toEqual([]);
    expect([0, 1, 2, 3].map((cursor) => pickOwner(halbe, { source: "kaltakquise" }, candidates, cursor).userId)).toEqual([1, 2, 1, 2]); // 50/50, Vertriebler 3 ohne Anteil bekommt nichts
    expect(pickOwner(halbe, { source: "kaltakquise" }, candidates, 0).reason).toBe("Anteil 50 %");
    expect(pickOwner(halbe, { source: "email" }, candidates, 0)).toMatchObject({ userId: null, reason: "Verteilung aus" }); // Ausnahme: E-Mail-Pipeline aus
    expect(pickOwner(halbe, { source: "ads" }, [{ userId: 3, openCount: 0 }], 0)).toMatchObject({ userId: 3, reason: "reihum" }); // keiner der Anteils-Vertriebler mehr im Team → reihum
    const nurKalt = normalizePipelineSettings({ distribution: { mode: "aus", perPipeline: { kaltakquise: { mode: "anteile", shares: [{ userId: 1, percent: 70 }, { userId: 2, percent: 30 }] } } } }).distribution;
    expect(distributionActive(nurKalt)).toBe(true); expect(distributionActive(normalizePipelineSettings({}).distribution)).toBe(false);
    expect(pickOwner(nurKalt, { source: "ads" }, candidates, 0).userId).toBeNull(); expect(pickOwner(nurKalt, { source: null }, candidates, 0).userId).toBeNull();
    expect(Array.from({ length: 10 }, (_, cursor) => pickOwner(nurKalt, { source: "kaltakquise" }, candidates, cursor).userId).filter((id) => id === 1)).toHaveLength(7);
    expect(pickOwner(nurKalt, { source: "kaltakquise" }, candidates, 0).reason).toBe("Anteil 70 % (Kaltakquise)");
    expect(effectiveDistribution(nurKalt, "kaltakquise").scope).toBe("kaltakquise"); expect(effectiveDistribution(nurKalt, "email").scope).toBe("standard");
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
  it("Standard-Versandfenster: werktags 7:30–17:00 Uhr Berlin, freitags nur bis 13:00; ältere Kampagnen ohne Fenster senden rund um die Uhr", () => {
    expect(DEFAULT_SEND_WINDOW).toEqual({ enabled: true, weekdays: [1, 2, 3, 4, 5], from: "07:30", to: "17:00", timezone: "Europe/Berlin", days: { "5": { from: "07:30", to: "13:00" } } });
    expect(nextSendSlot(new Date(Date.UTC(2026, 9, 13, 5, 0)), DEFAULT_SEND_WINDOW)?.toISOString()).toBe("2026-10-13T05:30:00.000Z"); // Dienstag 7:00 Berlin → 7:30
    expect(nextSendSlot(new Date(Date.UTC(2026, 9, 13, 15, 30)), DEFAULT_SEND_WINDOW)?.toISOString()).toBe("2026-10-14T05:30:00.000Z"); // Dienstag 17:30 Berlin → Mittwoch 7:30
    expect(nextSendSlot(new Date(Date.UTC(2026, 9, 16, 15, 30)), DEFAULT_SEND_WINDOW)?.toISOString()).toBe("2026-10-19T05:30:00.000Z"); // Freitag 17:30 → Montag 7:30
    expect(nextSendSlot(new Date(Date.UTC(2026, 9, 16, 11, 30)), DEFAULT_SEND_WINDOW)?.toISOString()).toBe("2026-10-19T05:30:00.000Z"); // Freitag 13:30 Berlin → nach 13 Uhr zu, also Montag 7:30
    expect(nextSendSlot(new Date(Date.UTC(2026, 9, 16, 9, 0)), DEFAULT_SEND_WINDOW)).toBeNull(); // Freitag 11:00 Berlin → noch im Fenster
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

describe("Versandfenster je Wochentag und Fußzeile", () => {
  it("Freitag endet um 13 Uhr, die übrigen Werktage um 17 Uhr", () => {
    const window = resolveSendWindow({ enabled: true, weekdays: [1, 2, 3, 4, 5], from: "07:30", to: "17:00", timezone: "Europe/Berlin", days: { "5": { from: "07:30", to: "13:00" } } });
    expect(windowForDay(window, 2)).toEqual({ from: "07:30", to: "17:00" }); // Dienstag: allgemein
    expect(windowForDay(window, 5)).toEqual({ from: "07:30", to: "13:00" }); // Freitag: Ausnahme
    expect(windowForDay(window, 6)).toBeNull(); // Samstag: gar nicht
    expect(nextSendSlot(new Date(Date.UTC(2026, 9, 16, 9, 0)), window)).toBeNull(); // Freitag 11:00 Berlin → senden
    expect(nextSendSlot(new Date(Date.UTC(2026, 9, 16, 11, 30)), window)?.toISOString()).toBe("2026-10-19T05:30:00.000Z"); // Freitag 13:30 → Montag
  });
  it("Eigene Zeiten lassen sich pro Tag entfernen – dann gilt wieder das allgemeine Fenster", () => {
    const window = resolveSendWindow({ enabled: true, weekdays: [1, 5], from: "08:00", to: "18:00", timezone: "Europe/Berlin", days: null });
    expect(windowForDay(window, 5)).toEqual({ from: "08:00", to: "18:00" });
  });
  it("Fußzeile: Anschrift, Webseite und Terminlink werden anklickbar", () => {
    const text = companyFooterText({ website: "tanescodigital.de", appointment: "https://cal.com/tanesco" });
    expect(text).toContain("Tanesco Digital GbR");
    expect(text).toContain("tanescodigital.de · https://cal.com/tanesco");
    const html = linkifyFooter("Tanesco Digital GbR · Schultheißweg 44 · 55252 Wiesbaden<br>tanescodigital.de · https://cal.com/tanesco");
    expect(html).toContain('<a href="https://tanescodigital.de"');
    expect(html).toContain('<a href="https://cal.com/tanesco"');
    expect(html).toContain("Schultheißweg 44"); // Anschrift bleibt Text
  });
  it("Fußzeile: Links mit eigenem Text, E-Mail- und Telefonlinks", () => {
    const mitText = linkifyFooter("[Termin vereinbaren](https://cal.com/tanesco) · [Schreib uns](mailto:kontakt@tanescodigital.de)");
    expect(mitText).toContain('<a href="https://cal.com/tanesco"');
    expect(mitText).toContain(">Termin vereinbaren</a>");
    expect(mitText).toContain('<a href="mailto:kontakt@tanescodigital.de"');
    expect(mitText).not.toContain("[Termin"); // Klammern verschwinden
    expect(linkifyFooter("[Webseite](tanescodigital.de)")).toContain('href="https://tanescodigital.de"'); // ohne https:// davor
    expect(linkifyFooter("Preise ab 5 [EUR] pro Lead")).toBe("Preise ab 5 [EUR] pro Lead"); // eckige Klammern ohne Adresse bleiben stehen
    expect(linkifyFooter("[Termin vereinbaren](https://)")).toBe("Termin vereinbaren"); // Adresse noch nicht eingetragen → nur Text, kein toter Link
    expect(linkifyFooter("[Rückruf](tel:+4969000000)")).toContain('href="tel:+4969000000"');
  });
});

describe("Persönlicher Versand (weniger Werbung-Ordner)", () => {
  const blocks = [
    { type: "heading", text: "Kurze Frage" },
    { type: "text", text: "Guten Tag {{nachname}}," },
    { type: "button", text: "Testleads anfordern", url: "https://tanescodigital.de/test", align: "center" },
  ] as never[];
  const optionen = { trackingPixelUrl: "https://app.test/api/mail/o/abc.gif", wrapLink: (url: string) => `https://app.test/api/mail/c/abc?u=${encodeURIComponent(url)}`, unsubscribeUrl: "https://app.test/api/mail/u/abc", logoBase: "https://app.test" };

  it("Normal: Logo, farbiger Knopf, Zählpixel und umgeschriebene Links", () => {
    const html = renderEmailHtml(blocks, { ...DEFAULT_DESIGN }, { nachname: "Berg" }, optionen);
    expect(html).toContain("tanesco-logo-mail.png");
    expect(html).toContain("/api/mail/o/abc.gif"); // Zählpixel
    expect(html).toContain("/api/mail/c/abc"); // Link läuft über uns
    expect(html).toContain("border-radius"); // Knopf als Fläche
  });
  it("Persönlich: kein Logo, kein Pixel, Links direkt, Knopf als Textlink", () => {
    const html = renderEmailHtml(blocks, { ...DEFAULT_DESIGN, plain: true, footerText: "Tanesco Digital · {{abmelden}}" }, { nachname: "Berg" }, optionen); // Fußzeile ist standardmäßig leer – hier mit Abmelde-Platzhalter
    expect(html).not.toContain("tanesco-logo-mail.png");
    expect(html).not.toContain("/api/mail/o/abc.gif");
    expect(html).toContain("Testleads anfordern");
    expect(html).not.toContain("box-shadow"); // kein Kasten
    expect(html).toContain("/api/mail/u/abc"); // Abmelde-Link bleibt
    expect(html).toContain("Guten Tag Berg,"); // Platzhalter werden weiter gefüllt
  });
});

describe("Schritte im Ablauf verschieben", () => {
  const baum = (): EmailTree => ({
    start: "a",
    nodes: [
      { id: "a", type: "send", label: "1. E-Mail", subject: "Erste", blocks: [{ id: "t1", type: "text", text: "Hallo" }], next: "w" },
      { id: "w", type: "wait", hours: 48, next: "c" },
      { id: "c", type: "condition", check: "opened", yes: "b", no: "n" },
      { id: "b", type: "send", label: "Dann-Mail", subject: "Dann", blocks: [{ id: "t2", type: "text", text: "Dann" }], next: null },
      { id: "n", type: "send", label: "Sonst-Mail", subject: "Sonst", blocks: [{ id: "t3", type: "text", text: "Sonst" }], next: null },
    ],
  });

  it("E-Mail hinter einen anderen Schritt hängen – der Rest bleibt verbunden", () => {
    const next = moveNodeInTree(baum(), "a", "w", "next");
    expect(next.start).toBe("w"); // der Nachfolger rückt an den Anfang
    expect(next.nodes.find((node) => node.id === "w")).toMatchObject({ next: "a" });
    expect(next.nodes.find((node) => node.id === "a")).toMatchObject({ next: "c" });
    expect(validateTree(next)).toHaveLength(0);
  });
  it("E-Mail in den Sonst-Zweig verschieben", () => {
    const next = moveNodeInTree(baum(), "a", "c", "no");
    expect(next.start).toBe("w"); // a war Start, jetzt folgt w
    expect(next.nodes.find((node) => node.id === "c")).toMatchObject({ no: "a", yes: "b" });
    expect(next.nodes.find((node) => node.id === "a")).toMatchObject({ next: "n" }); // hängt vor der bisherigen Sonst-Mail
    expect(validateTree(next)).toHaveLength(0);
  });
  it("Aus einem Zweig zurück an den Anfang", () => {
    const next = moveNodeInTree(baum(), "b", null, "next");
    expect(next.start).toBe("b");
    expect(next.nodes.find((node) => node.id === "b")).toMatchObject({ next: "a" });
    expect(next.nodes.find((node) => node.id === "c")).toMatchObject({ yes: null });
    expect(validateTree(next)).toHaveLength(0);
  });
  it("Auf sich selbst oder eine Verzweigung verschieben ändert nichts", () => {
    const tree = baum();
    expect(moveNodeInTree(tree, "a", "a", "next")).toBe(tree);
    expect(moveNodeInTree(tree, "c", "a", "next")).toBe(tree); // Verzweigungen lassen sich nicht verschieben
    expect(moveNodeInTree(tree, "gibtsnicht", null, "next")).toBe(tree);
  });
});

describe("Heiße Phasen (Lead-Temperatur)", () => {
  const now = new Date("2026-10-15T10:00:00Z");
  const base = { pipelineStage: "neu", stages: PIPELINE_STAGES, createdAt: now, lastActivityAt: now };
  it("frischer Kontakt mit allen Daten ist gerade warm (30 Punkte), ohne Daten und ohne Bewegung kalt", () => {
    const voll = leadScore({ ...base, phone: "+49 160 1", email: "max@beispiel.de", company: "Muster GmbH" }, now);
    expect(voll.score).toBe(16 + 14); expect(voll.temperature).toBe("warm"); expect(voll.reasons[0]).toContain("Telefon, E-Mail und Firma bekannt");
    const leer = leadScore({ ...base, createdAt: new Date("2026-09-01T10:00:00Z"), lastActivityAt: new Date("2026-09-01T10:00:00Z") }, now);
    expect(leer.score).toBe(0); expect(leer.temperature).toBe("kalt"); expect(leer.reasons).toContain("Weder Telefon noch E-Mail bekannt");
  });
  it("Termin, Antwort und gute Stufe machen die Karte heiß – Absagen kühlen ab", () => {
    const heiss = leadScore({ ...base, pipelineStage: "termin", phone: "+49 160 1", email: "max@beispiel.de", appointmentAt: new Date("2026-10-20T09:00:00Z"), mail: { opened: true, clicked: true, replied: true }, dealValue: 12500 }, now);
    expect(heiss.temperature).toBe("heiss"); expect(heiss.score).toBeGreaterThanOrEqual(60); expect(heiss.reasons.some((reason) => reason.startsWith("Termin am 20.10."))).toBe(true); expect(heiss.reasons.some((reason) => reason.includes("geantwortet"))).toBe(true);
    const abgesagt = leadScore({ ...base, pipelineStage: "termin", phone: "+49 160 1", email: "max@beispiel.de", appointmentAt: new Date("2026-10-20T09:00:00Z"), mail: { unsubscribed: true }, lastCallDisposition: "kein_interesse" }, now);
    expect(abgesagt.score).toBeLessThan(heiss.score - 40); expect(abgesagt.reasons).toContain("Von unseren E-Mails abgemeldet (−15)"); expect(abgesagt.reasons).toContain("Letzter Anruf: kein Interesse (−25)");
    const eingeschlafen = leadScore({ ...base, phone: "+49 160 1", lastActivityAt: new Date("2026-10-01T10:00:00Z"), stale: true, staleDays: 5 }, now);
    expect(eingeschlafen.score).toBe(0); expect(eingeschlafen.reasons).toContain("Seit 14 Tagen eingeschlafen (−10)");
  });
  it("Kunde und Verloren haben keine Temperatur mehr; Schwellen 60/30", () => {
    expect(leadScore({ ...base, pipelineStage: "kunde" }, now)).toMatchObject({ score: 100, label: "Kunde", closed: true });
    expect(leadScore({ ...base, pipelineStage: "verloren" }, now)).toMatchObject({ score: 0, label: "Verloren", closed: true });
    expect(temperatureOf(60)).toBe("heiss"); expect(temperatureOf(59)).toBe("warm"); expect(temperatureOf(30)).toBe("warm"); expect(temperatureOf(29)).toBe("kalt");
  });
  it("fasst die E-Mail-Reaktion aus Serien-Einträgen und Posteingang zusammen", () => {
    expect(mailReactionOf([])).toBeNull();
    expect(mailReactionOf([{ openedAt: now, clickedAt: null, repliedAt: null, status: "aktiv" }, { openedAt: null, status: "bounce" }])).toMatchObject({ opened: true, clicked: false, replied: false, bounced: true, unsubscribed: false });
    expect(mailReactionOf([], true)).toMatchObject({ replied: true, opened: false });
    expect(mailReactionOf([{ status: "abgemeldet" }])).toMatchObject({ unsubscribed: true });
  });
});


describe("Anrufzähler und Verteilung beim Listen-Upload", () => {
  it("ordnet Dialer-Ergebnisse dem Zähler zu und formuliert den Kurztext", () => {
    expect(callResultOfDialer("beendet")).toBe("erreicht"); expect(callResultOfDialer("besetzt")).toBe("besetzt"); expect(callResultOfDialer("anrufbeantworter")).toBe("mailbox");
    expect(callResultOfDialer("keine_antwort")).toBe("nicht_erreicht"); expect(callResultOfDialer("fehlgeschlagen", "falsche_nummer")).toBe("falsche_nummer"); expect(callResultOfDialer("beendet", "wiedervorlage")).toBe("rueckruf");
    const now = new Date(2026, 9, 16, 11, 0);
    expect(callCounterText({ count: 3, lastAt: new Date(2026, 9, 16, 10, 8), lastResult: "mailbox" }, now)).toBe("3 Anrufe · zuletzt heute 10:08 · Mailbox");
    expect(callCounterText({ count: 1, lastAt: new Date(2026, 9, 14, 9, 0), lastResult: "erreicht" }, now)).toMatch(/^1 Anruf · zuletzt Mi\.?,? 14\.10\. · erreicht$/);
    expect(callCounterText({ count: 0, lastAt: null, lastResult: null }, now)).toBeNull();
    expect(CALL_RESULTS.filter((item) => item.reached).map((item) => item.key)).toEqual(["erreicht", "rueckruf"]);
  });
  it("kennt die Stufen „In Bearbeitung“ und „Kontaktiert“ – auch bei eigenen Namen", () => {
    expect(workingStage(PIPELINE_STAGES)).toBe("in_bearbeitung"); expect(contactedStage(PIPELINE_STAGES)).toBe("kontaktiert");
    const custom = [{ key: "neu", label: "Neu", hint: "", fixed: "entry" as const }, { key: "stufe_wird_angerufen", label: "Wird angerufen", hint: "" }, { key: "stufe_erreicht", label: "Erreicht", hint: "" }, { key: "kunde", label: "Kunde", hint: "", fixed: "won" as const }, { key: "verloren", label: "Verloren", hint: "", fixed: "lost" as const }];
    expect(workingStage(custom)).toBe("stufe_wird_angerufen"); expect(contactedStage(custom)).toBe("stufe_erreicht");
    expect(workingStage([custom[0], custom[3], custom[4]])).toBeNull();
    expect(PIPELINE_STAGES.map((stage) => stage.key).slice(0, 3)).toEqual(["neu", "in_bearbeitung", "kontaktiert"]);
  });
  it("teilt Kontakte prozentual, nach Anzahl oder gleichmäßig auf – Reste nach größtem Bruchteil, Zuteilung im Wechsel", () => {
    expect(splitShares(10, [{ userId: 1, value: 70 }, { userId: 2, value: 30 }], "prozent")).toEqual([{ userId: 1, count: 7 }, { userId: 2, count: 3 }]);
    expect(splitShares(10, [{ userId: 1, value: 50 }, { userId: 2, value: 50 }, { userId: 3, value: 50 }], "prozent").map((item) => item.count)).toEqual([4, 3, 3]); // Anteile müssen nicht 100 ergeben
    expect(splitShares(7, [{ userId: 1, value: 1 }, { userId: 2, value: 1 }], "gleich").map((item) => item.count)).toEqual([4, 3]);
    expect(splitShares(10, [{ userId: 1, value: 4 }, { userId: 2, value: 3 }], "anzahl").map((item) => item.count)).toEqual([4, 3]); // 3 bleiben offen
    expect(splitShares(5, [{ userId: 1, value: 10 }, { userId: 2, value: 10 }], "anzahl").map((item) => item.count)).toEqual([5, 0]); // nicht mehr als da sind
    expect(splitShares(10, [], "prozent")).toEqual([]); expect(splitShares(0, [{ userId: 1, value: 100 }], "prozent")).toEqual([]);
    const sequence = ownerSequence(10, [{ userId: 1, value: 70 }, { userId: 2, value: 30 }], "prozent");
    expect(sequence.filter((id) => id === 1).length).toBe(7); expect(sequence.filter((id) => id === 2).length).toBe(3);
    expect(sequence.slice(0, 4)).not.toEqual([1, 1, 1, 1]); // abwechselnd, nicht erst alle für einen
    expect(ownerSequence(5, [{ userId: 1, value: 2 }], "anzahl")).toEqual([1, 1, null, null, null]);
  });
  it("merkt sich die Reihenfolge der Pipelines – ungültige oder fehlende Einträge werden ergänzt", () => {
    expect(normalizePipelineSettings({}).sourceOrder).toEqual(["email", "ads", "kaltakquise"]);
    expect(normalizePipelineSettings({ sourceOrder: ["kaltakquise", "ads", "email"] }).sourceOrder).toEqual(["kaltakquise", "ads", "email"]);
    expect(normalizeSourceOrder(["ads", "ads", "quatsch"])).toEqual(["ads", "email", "kaltakquise"]);
  });
});
