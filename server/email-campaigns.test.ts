import { describe, expect, it } from "vitest";
import { advanceRecipient, recipientValues, starterTree, validateTree, summarizeCampaign } from "../shared/email-campaigns";
import { fillPlaceholders, renderEmailHtml, renderEmailText, starterBlocks, usesSignature } from "../shared/email-design";
import { renderNode } from "../shared/email-campaigns";
import { detectMapping, extraFieldsOf, parseColdList, placeholderKey } from "../shared/cold-list";

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
