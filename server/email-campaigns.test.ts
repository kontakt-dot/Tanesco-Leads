import { describe, expect, it } from "vitest";
import { advanceRecipient, audienceLists, canEnroll, listAudience, eventLabel, maxRunsLabel, maxRunsOf, recipientPath, recipientValues, REPLY_STOP_NOTE, resolveWaiting, starterTree, stoppedByReply, stopsOnReply, validateTree, summarizeCampaign, waitingText } from "../shared/email-campaigns";
import { isAutoReply, looksLikeAutoReplySubject } from "../shared/reply-ai";
import { fillPlaceholders, renderEmailHtml, renderEmailText, starterBlocks, usesSignature } from "../shared/email-design";
import { renderNode } from "../shared/email-campaigns";
import { detectMapping, extraFieldsOf, parseColdList, placeholderKey } from "../shared/cold-list";

describe("E-Mail-Kampagnen: Wartezeit – Leads stehen am Warten-Schritt, Ablaufänderungen gelten für Wartende", () => {
  const blocks = starterBlocks("kaltakquise"); const start = { nodeId: null, nextActionAt: null, status: "wartet" as const, sentCount: 0, openedAt: null, clickedAt: null, repliedAt: null, lastSentAt: null };
  const t0 = new Date("2026-10-01T09:00:00");
  it("während der Wartezeit steht der Lead am Warten-Schritt – was danach kommt, wird erst am Ende der Wartezeit nachgesehen", async () => {
    // Ablauf beim Start: Erste → 7 Tage warten → Ende. Vier Leads bekommen die Erste und warten.
    const before = { start: "m1", nodes: [{ id: "m1", type: "send" as const, label: "Erste", subject: "Erste", blocks, next: "w1" }, { id: "w1", type: "wait" as const, hours: 168, next: "e1" }, { id: "e1", type: "end" as const, label: "Ende" }] };
    const sent: string[] = []; const send = async (node: { subject: string }) => { sent.push(node.subject); return true; };
    const waiting = await advanceRecipient(before, start, t0, send);
    expect(sent).toEqual(["Erste"]); expect(waiting.state).toMatchObject({ status: "wartet", nodeId: "w1", waitingAt: "w1", sentNodeIds: ["m1"] }); expect(waiting.state.nextActionAt?.getTime()).toBe(t0.getTime() + 168 * 3_600_000);
    expect(waiting.events.map((event) => event.kind)).toEqual(["gesendet", "gewartet"]); expect(waiting.events[1].nodeId).toBe("w1");
    // Inzwischen wird hinter dem Warten eine „Kurze Nachfrage“ eingefügt (oder das Warten davor geschoben) – die Wartenden bekommen sie, statt direkt ans Ende zu springen
    const after = { start: "m1", nodes: [before.nodes[0], { id: "w1", type: "wait" as const, hours: 168, next: "m2" }, { id: "m2", type: "send" as const, label: "Kurze Nachfrage", subject: "Kurze Nachfrage", blocks: starterBlocks("nachfassen"), next: "e1" }, before.nodes[2]] };
    const tooEarly = await advanceRecipient(after, waiting.state, new Date(t0.getTime() + 100 * 3_600_000), send); expect(sent).toEqual(["Erste"]); expect(tooEarly.state.nodeId).toBe("w1");
    const due = await advanceRecipient(after, waiting.state, new Date(t0.getTime() + 169 * 3_600_000), send);
    expect(sent).toEqual(["Erste", "Kurze Nachfrage"]); expect(due.state.status).toBe("fertig"); expect(due.state.sentCount).toBe(2); expect(due.events.map((event) => event.kind)).toEqual(["gesendet", "beendet"]);
    // Unverändert (Ende direkt hinter dem Warten): nach der Wartezeit fertig, keine weitere E-Mail
    const unchanged = await advanceRecipient(before, waiting.state, new Date(t0.getTime() + 169 * 3_600_000), send); expect(sent).toHaveLength(2); expect(unchanged.state.status).toBe("fertig"); expect(unchanged.events).toEqual([{ kind: "beendet", nodeId: "e1", note: "Ende" }]);
    // Warten ohne weiteren Schritt dahinter: nach der Wartezeit fertig – nie wieder von vorn
    const open = { start: "m1", nodes: [before.nodes[0], { id: "w1", type: "wait" as const, hours: 168, next: null }] };
    const w = await advanceRecipient(open, start, t0, send); expect(w.state).toMatchObject({ status: "wartet", nodeId: "w1" });
    const done = await advanceRecipient(open, w.state, new Date(t0.getTime() + 169 * 3_600_000), send); expect(done.state.status).toBe("fertig"); expect(done.events[0].note).toContain("kein weiterer Schritt"); expect(sent).toHaveLength(3);
    // Ohne Schritt, aber schon E-Mails bekommen → fertig statt Neustart (Doppelversand-Schutz)
    const orphan = await advanceRecipient(before, { ...start, nodeId: null, sentCount: 1, lastSentAt: t0 }, new Date(t0.getTime() + 200 * 3_600_000), send); expect(orphan.state.status).toBe("fertig"); expect(sent).toHaveLength(3);
  });
  it("dieselbe E-Mail geht in einem Durchlauf nie zweimal raus – auch wenn der Ablauf umgebaut wurde", async () => {
    const tree = { start: "m1", nodes: [{ id: "m1", type: "send" as const, label: "Erste", subject: "Erste", blocks, next: "w1" }, { id: "w1", type: "wait" as const, hours: 1, next: "m2" }, { id: "m2", type: "send" as const, label: "Zweite", subject: "Zweite", blocks, next: null }] };
    const sent: string[] = []; const send = async (node: { subject: string }) => { sent.push(node.subject); return true; };
    // Der Lead steht nach einem Umbau wieder vor der Ersten, hat sie laut Verlauf aber schon bekommen → übersprungen, weiter mit dem Rest
    const result = await advanceRecipient(tree, { ...start, nodeId: "m1", sentCount: 1, lastSentAt: t0, sentNodeIds: ["m1"] }, new Date(t0.getTime() + 60_000), send);
    expect(sent).toEqual([]); expect(result.state).toMatchObject({ status: "wartet", nodeId: "w1" }); expect(result.events[0]).toMatchObject({ kind: "verzweigt", nodeId: "m1" }); expect(result.events[0].note).toContain("Übersprungen"); expect(eventLabel(result.events[0])).toBe("E-Mail übersprungen (schon gesendet)");
    const later = await advanceRecipient(tree, result.state, new Date(t0.getTime() + 2 * 3_600_000), send); expect(sent).toEqual(["Zweite"]); expect(later.state.status).toBe("fertig");
  });
  it("resolveWaiting: Wartezeit-Stand aus dem Verlauf – alte Einträge rücken auf den Warten-Schritt, Versandfenster-Pausen bleiben", () => {
    const tree = { start: "m1", nodes: [{ id: "m1", type: "send" as const, label: "Erste", subject: "Erste", blocks, next: "w1" }, { id: "w1", type: "wait" as const, hours: 168, next: "m2" }, { id: "m2", type: "send" as const, label: "Zweite", subject: "Zweite", blocks, next: "e1" }, { id: "e1", type: "end" as const, label: "Ende" }] };
    const sentEvent = { id: 1, kind: "gesendet", nodeId: "m1", createdAt: t0 }; const waited = { id: 2, kind: "gewartet", nodeId: "w1", createdAt: t0 }; // gleiche Sekunde – die Reihenfolge entscheidet die id
    // Alte Form: stand schon am Schritt NACH dem Warten (hier sogar am Ende, weil der Ablauf später geändert wurde) → zurück auf den Warten-Schritt
    expect(resolveWaiting(tree, { nodeId: "e1", status: "wartet" }, [sentEvent, waited])).toEqual({ nodeId: "w1", waitingAt: "w1", sentNodeIds: ["m1"] });
    expect(resolveWaiting(tree, { nodeId: "m2", status: "wartet" }, [waited, sentEvent])).toEqual({ nodeId: "w1", waitingAt: "w1", sentNodeIds: ["m1"] });
    // Neue Form: steht schon am Warten-Schritt → unverändert, waitingAt gesetzt
    expect(resolveWaiting(tree, { nodeId: "w1", status: "wartet" }, [sentEvent, waited])).toEqual({ nodeId: "w1", waitingAt: "w1", sentNodeIds: ["m1"] });
    // Versandfenster-Pause an einer E-Mail (kein Warten-Schritt) → bleibt, wo sie ist
    const paused = { id: 3, kind: "gewartet", nodeId: "m2", createdAt: new Date(t0.getTime() + 1000) };
    expect(resolveWaiting(tree, { nodeId: "m2", status: "wartet" }, [sentEvent, waited, paused])).toEqual({ nodeId: "m2", waitingAt: null, sentNodeIds: ["m1"] });
    // Öffnung oder Klick während der Wartezeit ändern nichts – die Wartezeit läuft weiter
    expect(resolveWaiting(tree, { nodeId: "w1", status: "wartet" }, [sentEvent, waited, { id: 4, kind: "geklickt", nodeId: "m1", createdAt: new Date(t0.getTime() + 5000) }])).toEqual({ nodeId: "w1", waitingAt: "w1", sentNodeIds: ["m1"] });
    // Frisch aufgenommen (kein Verlauf) oder nicht im Status „wartet“ → unverändert
    expect(resolveWaiting(tree, { nodeId: "m1", status: "wartet" }, [])).toEqual({ nodeId: "m1", waitingAt: null, sentNodeIds: [] });
    expect(resolveWaiting(tree, { nodeId: "m2", status: "laeuft" }, [sentEvent, waited])).toEqual({ nodeId: "m2", waitingAt: null, sentNodeIds: ["m1"] });
    // Warten-Schritt inzwischen gelöscht → kein Zurücksetzen auf einen fehlenden Schritt
    expect(resolveWaiting({ ...tree, nodes: tree.nodes.filter((node) => node.id !== "w1") }, { nodeId: "m2", status: "wartet" }, [sentEvent, waited])).toEqual({ nodeId: "m2", waitingAt: null, sentNodeIds: ["m1"] });
    // Lead-Log: der Warten-Schritt ist „aktuell“, die E-Mail danach „offen“
    const steps = recipientPath(tree, { nodeId: "w1", status: "wartet", sentCount: 1 }, [sentEvent, { ...waited, note: "Wartet 168 Stunden" }]);
    expect(steps.map((step) => [step.id, step.state])).toEqual([["m1", "erledigt"], ["w1", "aktuell"], ["m2", "offen"], ["e1", "offen"]]);
  });
});

describe("E-Mail-Kampagnen: Ablauf-Baum und Builder", () => {
  it("läuft die Serie: senden → warten → wenn geöffnet → Dann-Zweig, sonst Sonst-Zweig", async () => {
    const tree = starterTree({ first: starterBlocks("kaltakquise"), followUp: starterBlocks("nachfassen") }); expect(validateTree(tree)).toEqual([]);
    const sent: string[] = []; const send = async (node: { subject: string }) => { sent.push(node.subject); return true; };
    const t0 = new Date("2026-10-01T09:00:00"); const start = { nodeId: null, nextActionAt: null, status: "wartet" as const, sentCount: 0, openedAt: null, clickedAt: null, repliedAt: null, lastSentAt: null };
    const first = await advanceRecipient(tree, start, t0, send); expect(sent).toEqual(["Mehr Anfragen für {{firma}} – ohne Risiko"]); expect(first.state.status).toBe("wartet"); expect(first.state.nextActionAt?.getTime()).toBe(t0.getTime() + 72 * 3_600_000);
    const tooEarly = await advanceRecipient(tree, first.state, new Date(t0.getTime() + 3_600_000), send); expect(sent).toHaveLength(1); expect(tooEarly.state.nodeId).toBe(first.state.nodeId);
    const opened = await advanceRecipient(tree, { ...first.state, openedAt: new Date(t0.getTime() + 5 * 3_600_000) }, new Date(t0.getTime() + 73 * 3_600_000), send); expect(sent[1]).toContain("Kurze Frage"); expect(opened.state.status).toBe("fertig"); expect(opened.events.map((event) => event.kind)).toEqual(["verzweigt", "gesendet", "beendet"]);
    const sentBefore = sent.length; const notOpened = await advanceRecipient(tree, first.state, new Date(t0.getTime() + 73 * 3_600_000), send); expect(sent[sentBefore]).toContain("Haben Sie meine E-Mail gesehen"); expect(notOpened.events[0].note).toContain("nein → Sonst");
    const failing = await advanceRecipient(tree, start, t0, async () => false); expect(failing.state.status).toBe("fehler");
    expect(summarizeCampaign([{ status: "fertig", sentCount: 2, openedAt: new Date(), clickedAt: null, repliedAt: null }, { status: "wartet", sentCount: 1, openedAt: null, clickedAt: null, repliedAt: null }])).toMatchObject({ total: 2, sent: 2, opened: 1, openRate: 50 });
  });
  it("Antwort-Stopp: hat der Kontakt geantwortet, geht keine E-Mail mehr raus – egal wie der Ablauf gebaut ist", async () => {
    // Ablauf OHNE „Wenn geantwortet“-Verzweigung: E-Mail → 1 Std. warten → zweite E-Mail → dritte E-Mail
    const tree = { start: "m1", nodes: [{ id: "m1", type: "send" as const, label: "Erste", subject: "Erste", blocks: starterBlocks("kaltakquise"), next: "w1" }, { id: "w1", type: "wait" as const, hours: 1, next: "m2" }, { id: "m2", type: "send" as const, label: "Zweite", subject: "Zweite", blocks: starterBlocks("nachfassen"), next: "m3" }, { id: "m3", type: "send" as const, label: "Dritte", subject: "Dritte", blocks: starterBlocks("nachfassen"), next: null }] };
    expect(validateTree(tree)).toEqual([]);
    const sent: string[] = []; const send = async (node: { subject: string }) => { sent.push(node.subject); return true; };
    const t0 = new Date("2026-10-01T09:00:00"); const start = { nodeId: null, nextActionAt: null, status: "wartet" as const, sentCount: 0, openedAt: null, clickedAt: null, repliedAt: null, lastSentAt: null };
    const first = await advanceRecipient(tree, start, t0, send); expect(sent).toEqual(["Erste"]); expect(first.state.status).toBe("wartet");
    // Antwort trifft ein, dann wird die Wartezeit fällig → Stopp statt zweiter E-Mail, Vermerk im Verlauf, Status endgültig
    const replied = { ...first.state, repliedAt: new Date(t0.getTime() + 600_000) };
    expect(stoppedByReply(replied)).toBe(true);
    const stopped = await advanceRecipient(tree, replied, new Date(t0.getTime() + 2 * 3_600_000), send);
    expect(sent).toEqual(["Erste"]); expect(stopped.state.status).toBe("fertig"); expect(stopped.state.nodeId).toBeNull(); expect(stopped.state.nextActionAt).toBeNull();
    expect(stopped.events).toEqual([{ kind: "beendet", nodeId: "w1", note: REPLY_STOP_NOTE }]); // steht während der Wartezeit AM Warten-Schritt
    // Ohne Antwort läuft die Serie normal weiter (Gegenprobe)
    const normal = await advanceRecipient(tree, first.state, new Date(t0.getTime() + 2 * 3_600_000), send); expect(sent).toEqual(["Erste", "Zweite", "Dritte"]); expect(normal.state.status).toBe("fertig");
    // Antwort kurz vor dem Senden (Nachprüfung im Versand-Rückruf) → Stopp ohne Versand, kein „Fehler“
    const lateSent: string[] = []; const lateStop = await advanceRecipient(tree, first.state, new Date(t0.getTime() + 2 * 3_600_000), async (node) => { lateSent.push(node.subject); return { ok: false, subject: node.subject, stopped: REPLY_STOP_NOTE }; });
    expect(lateSent).toEqual(["Zweite"]); expect(lateStop.state.status).toBe("fertig"); expect(lateStop.state.sentCount).toBe(1); expect(lateStop.events.map((event) => event.kind)).toEqual(["beendet"]);
    // Schalter „Bei Antwort anhalten“ bewusst aus → die Serie läuft trotz Antwort zu Ende
    const offSent: string[] = []; const off = await advanceRecipient(tree, replied, new Date(t0.getTime() + 2 * 3_600_000), async (node) => { offSent.push(node.subject); return true; }, { stopOnReply: false });
    expect(offSent).toEqual(["Zweite", "Dritte"]); expect(off.state.status).toBe("fertig"); expect(off.events.some((event) => event.note === REPLY_STOP_NOTE)).toBe(false);
    expect(stopsOnReply({ stopOnReply: false })).toBe(false); expect(stopsOnReply({})).toBe(true); expect(stopsOnReply(null)).toBe(true); // fehlt das Feld (alte Daten) → an
    // Bereits beendete/abgemeldete Einträge werden nicht noch einmal „gestoppt“
    expect(stoppedByReply({ status: "abgemeldet", repliedAt: new Date() })).toBe(false); expect(stoppedByReply({ status: "fertig", repliedAt: new Date() })).toBe(false); expect(stoppedByReply({ status: "laeuft", repliedAt: null })).toBe(false);
    // Abwesenheitsnotizen zählen nicht als Antwort
    expect(isAutoReply({ kind: "abwesenheit", confidence: 90 }, "Re: Mehr Anfragen")).toBe(true); expect(isAutoReply({ kind: "abwesenheit", confidence: 30 }, "Re: Mehr Anfragen")).toBe(false); expect(isAutoReply({ kind: "interessiert", confidence: 90 }, "Re: Mehr Anfragen")).toBe(false); expect(isAutoReply(null, "Re: Mehr Anfragen")).toBe(false);
    expect(looksLikeAutoReplySubject("Automatische Antwort: Mehr Anfragen")).toBe(true); expect(looksLikeAutoReplySubject("Out of Office – Re: Angebot")).toBe(true); expect(looksLikeAutoReplySubject("AW: Mehr Anfragen für Koch Dach")).toBe(false); expect(looksLikeAutoReplySubject(null)).toBe(false);
  });
  it("Mehrfach-Durchlauf: Standard einmal, sonst bis zu N – nie offen, nie nach Antwort/Bounce/Abmeldung", () => {
    expect(maxRunsOf({})).toBe(1); expect(maxRunsOf(null)).toBe(1); expect(maxRunsOf({ maxRuns: 3 })).toBe(3); expect(maxRunsOf({ maxRuns: 0 })).toBe(0);
    expect(maxRunsLabel(1)).toBe("jeder Kontakt nur einmal"); expect(maxRunsLabel(0)).toContain("unbegrenzt"); expect(maxRunsLabel(3)).toContain("3");
    expect(canEnroll([], 1).ok).toBe(true);
    expect(canEnroll([{ status: "fertig" }], 1)).toMatchObject({ ok: false, reason: "war schon einmal dabei" });
    expect(canEnroll([{ status: "fertig" }], 2).ok).toBe(true); expect(canEnroll([{ status: "fertig" }, { status: "fertig" }], 2).ok).toBe(false); expect(canEnroll([{ status: "fertig" }, { status: "fertig" }, { status: "fehler" }], 0).ok).toBe(true);
    expect(canEnroll([{ status: "wartet" }], 0)).toMatchObject({ ok: false, reason: "läuft bereits" });
    expect(canEnroll([{ status: "fertig", repliedAt: new Date() }], 0)).toMatchObject({ ok: false, reason: "hat geantwortet" });
    expect(canEnroll([{ status: "bounce" }], 0)).toMatchObject({ ok: false, reason: "gesperrt" }); expect(canEnroll([{ status: "abgemeldet" }], 5).ok).toBe(false);
    expect(canEnroll([{ status: "fehler" }], 1).ok).toBe(true); // Versandfehler zählt nicht als Durchlauf → nach dem Beheben erneut
  });
  it("Lead-Log: Weg durch den Ablauf (erledigt / aktuell / offen), Wartezeit-Text, Ereignis-Namen", () => {
    const tree = { start: "m1", nodes: [{ id: "m1", type: "send" as const, label: "Erste", subject: "Erste", blocks: starterBlocks("kaltakquise"), next: "w1" }, { id: "w1", type: "wait" as const, hours: 48, next: "c1" }, { id: "c1", type: "condition" as const, check: "opened" as const, yes: "e1", no: "m2" }, { id: "m2", type: "send" as const, label: "Zweite", subject: "Zweite", blocks: starterBlocks("nachfassen"), next: null }, { id: "e1", type: "end" as const, label: "Hat geöffnet" }] };
    const t0 = new Date("2026-10-01T09:00:00");
    // Nach der ersten Mail: wartet 48 h, nächster Schritt ist die Verzweigung
    const events = [{ kind: "gesendet", nodeId: "m1", subject: "Erste Mail", createdAt: t0 }, { kind: "gewartet", nodeId: "w1", note: "Wartet 2 Tage", createdAt: t0 }];
    const steps = recipientPath(tree, { nodeId: "c1", status: "wartet", sentCount: 1 }, events);
    expect(steps.map((step) => [step.id, step.state])).toEqual([["m1", "erledigt"], ["w1", "erledigt"], ["c1", "aktuell"], ["m2", "offen"]]);
    expect(steps[0].detail).toBe("Betreff: Erste Mail"); expect(steps[2].detail).toContain("Falls ja → Ende – Hat geöffnet"); expect(steps[2].detail).toContain("falls nein → E-Mail: Zweite");
    // Verzweigung geprüft (ja) → Ende erreicht, Sonst-Zweig taucht nicht auf
    const done = recipientPath(tree, { nodeId: null, status: "fertig", sentCount: 1 }, [...events, { kind: "verzweigt", nodeId: "c1", note: "Wenn geöffnet: ja → Dann-Zweig", createdAt: new Date(t0.getTime() + 1) }, { kind: "beendet", nodeId: "e1", note: "Hat geöffnet", createdAt: new Date(t0.getTime() + 2) }]);
    expect(done.map((step) => [step.id, step.state])).toEqual([["m1", "erledigt"], ["w1", "erledigt"], ["c1", "erledigt"], ["e1", "erledigt"]]); expect(done[2].branch).toBe("yes");
    // Antwort-Stopp mitten im Ablauf: zweite Mail abgebrochen, Rest übersprungen
    const stopped = recipientPath(tree, { nodeId: null, status: "fertig", sentCount: 1 }, [...events, { kind: "verzweigt", nodeId: "c1", note: "Wenn geöffnet: nein → Sonst-Zweig", createdAt: new Date(t0.getTime() + 1) }, { kind: "beendet", nodeId: "m2", note: REPLY_STOP_NOTE, createdAt: new Date(t0.getTime() + 2) }]);
    expect(stopped.map((step) => [step.id, step.state])).toEqual([["m1", "erledigt"], ["w1", "erledigt"], ["c1", "erledigt"], ["m2", "abgebrochen"]]); expect(stopped[3].detail).toBe(REPLY_STOP_NOTE);
    // Wartezeit-Text
    expect(waitingText(new Date(Date.now() + 2 * 86_400_000 + 3 * 3_600_000 + 60_000), "wartet")).toMatch(/^wartet noch 2 Tage 3 Std\. – bis/); expect(waitingText(new Date(Date.now() + 25 * 60_000), "wartet")).toMatch(/^wartet noch 25 Min\./);
    expect(waitingText(new Date(Date.now() - 1000), "wartet")).toContain("fällig"); expect(waitingText(null, "laeuft")).toContain("fällig"); expect(waitingText(new Date(), "fertig")).toBeNull();
    expect(eventLabel({ kind: "geoeffnet", note: "Antwort im Posteingang: „Re: Hallo“" })).toBe("Antwort erhalten"); expect(eventLabel({ kind: "geoeffnet", note: "E-Mail geöffnet" })).toBe("Geöffnet"); expect(eventLabel({ kind: "fehler" })).toBe("Fehler"); expect(eventLabel({ kind: "gewartet", note: "Abwesenheitsnotiz erhalten – zählt nicht" })).toBe("Abwesenheitsnotiz");
  });
  it("rendert Bausteine mit Platzhaltern, Tracking-Pixel und umgeschriebenen Links", () => {
    const html = renderEmailHtml(starterBlocks("kaltakquise"), { primaryColor: "#bc001d", textColor: "#101828", background: "#f3f4f6", cardBackground: "#ffffff", font: "Inter, sans-serif" }, { firma: "Hansen Bedachungen", anrede: "Herr", nachname: "Hansen", abmelden: "Abmelden: https://x.de/u" }, { trackingPixelUrl: "https://x.de/api/mail/o/t.gif", wrapLink: (url) => `https://x.de/api/mail/c/t?u=${encodeURIComponent(url)}` });
    expect(html).toContain("Mehr qualifizierte Anfragen für Hansen Bedachungen"); expect(html).toContain("Guten Tag Herr Hansen"); expect(html).toContain("https://x.de/api/mail/o/t.gif"); expect(html).toContain("api/mail/c/t?u=https%3A%2F%2Ftanesco.digital%2Ftermin"); expect(html).toContain("#bc001d");
  });
  it("hängt die Signatur aus den E-Mail-Einstellungen an jede Kampagnen-Mail – ein alter Signatur-Baustein wird ersetzt, per Schalter lässt sie sich abschalten", () => {
    const design = { primaryColor: "#bc001d", textColor: "#101828", background: "#f3f4f6", cardBackground: "#ffffff", font: "Inter, sans-serif" };
    const blocks = [...starterBlocks("kaltakquise")]; expect(blocks.some((block) => block.type === "signature")).toBe(true); // Startvorlage hat einen Signatur-Baustein
    const signature = { html: `<div class="sig">Mit freundlichen Grüßen<br><i>Thomas Kutzbach</i></div>`, text: "\n-- \nMit freundlichen Grüßen\nThomas Kutzbach" };
    const withSignature = renderEmailHtml(blocks, design, {}, { signatureHtml: signature.html });
    expect(withSignature).toContain('class="sig"'); expect(withSignature).not.toContain("Ihr Tanesco-Team"); // Baustein-Signatur weg, Einstellungs-Signatur drin
    expect(withSignature.indexOf('class="sig"')).toBeLessThan(withSignature.indexOf("Hier abmelden")); // vor der Fußzeile
    const without = renderEmailHtml(blocks, { ...design, signature: false }, {}, { signatureHtml: signature.html });
    expect(without).not.toContain('class="sig"'); expect(without).toContain("Ihr Tanesco-Team"); // Schalter aus → Baustein bleibt, keine Einstellungs-Signatur
    expect(usesSignature(design)).toBe(true); expect(usesSignature({ signature: false })).toBe(false); expect(usesSignature(null)).toBe(true);
    const text = renderEmailText(blocks, {}, signature.text); expect(text).toContain("Thomas Kutzbach"); expect(text).not.toContain("Ihr Tanesco-Team");
    const node = { id: "n1", type: "send" as const, subject: "Hallo {{vorname}}", blocks, next: null };
    const rendered = renderNode(node, design, { vorname: "Max" }, { signature });
    expect(rendered.html).toContain('class="sig"'); expect(rendered.text).toContain("Thomas Kutzbach");
    expect(renderNode(node, { ...design, signature: false }, { vorname: "Max" }, { signature }).html).not.toContain('class="sig"');
  });
  it("liest Kaltakquise-Listen mit erkannten Spalten (Semikolon, Anführungszeichen)", () => {
    const parsed = parseColdList('Vorname;Nachname;Firma;Telefon;E-Mail;PLZ;Ort\nPeter;Hansen;"Hansen, Bedachungen";+49 69 1;info@hansen.de;60311;Frankfurt\n;;Ohne Kontakt;;;;\nSabine;Koch;Koch Dach;;kontakt@koch.de;65183;Wiesbaden');
    expect(parsed.columns).toHaveLength(7); expect(parsed.rows).toHaveLength(2); expect(parsed.skipped).toBe(1); expect(parsed.rows[0]).toMatchObject({ firstName: "Peter", company: "Hansen, Bedachungen", phone: "+49 69 1", email: "info@hansen.de", city: "Frankfurt" });
    expect(parsed.mapping).toEqual(["firstName", "lastName", "company", "phone", "email", "postcode", "city"]); expect(parsed.placeholders).toEqual([]);
  });
  it("Spalten zuordnen: unbekannte Spalten werden Platzhalter, die Zuordnung lässt sich von Hand ändern", () => {
    const csv = "Name;Betrieb;Mail;Branche;Anzahl Mitarbeiter;Größe;Intern\nHansen;Hansen Dach;info@hansen.de;Dachdecker;12;groß;x\nKoch;Koch Solar;kontakt@koch.de;Photovoltaik;;klein;y";
    expect(detectMapping(["Name", "Betrieb", "Mail", "Branche", "Anzahl Mitarbeiter", "Größe", "Intern", ""])).toEqual(["lastName", "company", "email", "platzhalter", "platzhalter", "platzhalter", "platzhalter", "ignorieren"]);
    expect(placeholderKey("Anzahl Mitarbeiter")).toBe("anzahl_mitarbeiter"); expect(placeholderKey("Größe")).toBe("groesse"); expect(placeholderKey("Firma")).toBe("firma_liste"); expect(placeholderKey("2. Kontakt")).toBe("s2_kontakt");
    const auto = parseColdList(csv);
    expect(auto.placeholders).toEqual(["branche", "anzahl_mitarbeiter", "groesse", "intern"]); expect(auto.rows[0]).toMatchObject({ lastName: "Hansen", company: "Hansen Dach", email: "info@hansen.de", extra: { branche: "Dachdecker", anzahl_mitarbeiter: "12", groesse: "groß", intern: "x" } });
    expect(auto.rows[1].extra).toEqual({ branche: "Photovoltaik", groesse: "klein", intern: "y" }); // leere Zelle → kein Platzhalterwert
    // von Hand: „Betrieb“ ist doch der Nachname, „Intern“ weglassen, „Name“ als Firma
    const manual = parseColdList(csv, ["company", "lastName", "email", "platzhalter", "platzhalter", "ignorieren", "ignorieren"]);
    expect(manual.rows[0]).toMatchObject({ company: "Hansen", lastName: "Hansen Dach", extra: { branche: "Dachdecker", anzahl_mitarbeiter: "12" } }); expect(manual.placeholders).toEqual(["branche", "anzahl_mitarbeiter"]); expect(manual.mapping[5]).toBe("ignorieren");
    expect(parseColdList(csv, ["company"]).mapping).toHaveLength(7); // falsche Länge → automatisch
    // Platzhalter in der E-Mail: Zusatzfelder füllen, feste Felder gewinnen; Ziffern erlaubt
    const values = recipientValues({ firstName: "Peter", lastName: "Hansen", company: "Hansen Dach", fields: { branche: "Dachdecker", firma: "FALSCH", s2_kontakt: "Frau Koch" } });
    expect(values.firma).toBe("Hansen Dach"); expect((values as Record<string, string>).branche).toBe("Dachdecker");
    expect(fillPlaceholders("Hallo {{vorname}}, als {{branche}} ({{s2_kontakt}}) – {{unbekannt}}.", values)).toBe("Hallo Peter, als Dachdecker (Frau Koch) – .");
    expect(extraFieldsOf({ felder: { branche: "Dachdecker", leer: "", zahl: 3 } })).toEqual({ branche: "Dachdecker" }); expect(extraFieldsOf(null)).toEqual({}); expect(extraFieldsOf({ felder: [1] })).toEqual({});
  });
});

describe("E-Mail-Kampagnen: Zielgruppe aus mehreren Listen", () => {
  it("liest alte (eine Liste) und neue Kampagnen (mehrere Listen) gleich", () => {
    expect(audienceLists({ source: "liste", listName: "Alt" })).toEqual(["Alt"]);
    expect(audienceLists({ source: "liste", listName: "A", listNames: ["A", "B", " B ", ""] })).toEqual(["A", "B"]);
    expect(audienceLists({ source: "alle", listName: "A" })).toEqual([]);
    expect(listAudience(["B", "A", "B"])).toEqual({ source: "liste", listName: "B", listNames: ["B", "A"] });
    expect(listAudience([])).toEqual({ source: "liste", listName: null, listNames: [] });
  });
});
