import { describe, expect, it } from "vitest";
import { contractFunnel, deviceLabel, EMPTY_TRACKING, hottestOpen, proofEvents, sourceOf, summarizeContractEvents, trackingHint, trackingLine, trackingSteps, whenText, type TrackEvent } from "../shared/contract-tracking";

const UA_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const UA_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const local = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute);
const now = local(18, 15, 0);
const event = (kind: TrackEvent["kind"], at: Date, extra: Partial<TrackEvent> = {}): TrackEvent => ({ kind, createdAt: at, ...extra });
/** Ein Vertrag beim Kunden: gesendet, E-Mail zweimal geöffnet, Vertrag am PC und am Handy geöffnet. */
const journey: TrackEvent[] = [
  event("erstellt", local(15, 15)), event("gesendet", local(16, 11, 20)),
  event("mail_geoeffnet", local(16, 13, 5), { userAgent: UA_WIN, source: "mail" }), event("mail_geoeffnet", local(17, 8, 54), { userAgent: UA_WIN, source: "mail" }),
  event("angesehen", local(17, 8, 55), { userAgent: UA_WIN, source: "mail", seconds: 96, depth: 62 }),
  event("angesehen", local(17, 19, 40), { userAgent: UA_IPHONE, source: "link", seconds: 148, depth: 100 }),
];

describe("Verlauf eines Vertrags beim Kunden", () => {
  it("ohne Versand gibt es keinen Verlauf", () => {
    expect(summarizeContractEvents([])).toEqual(EMPTY_TRACKING); expect(summarizeContractEvents([event("erstellt", local(15, 15)), event("geaendert", local(15, 16))])).toEqual(EMPTY_TRACKING);
    expect(trackingLine(EMPTY_TRACKING, now)).toBe(""); expect(trackingHint(EMPTY_TRACKING, "entwurf", now)).toBeNull();
  });
  it("zählt Versand, geöffnete E-Mails, Aufrufe, Lesedauer, Lesetiefe und Geräte", () => {
    const tracking = summarizeContractEvents(journey);
    expect(tracking.sent).toEqual({ count: 1, firstAt: local(16, 11, 20).toISOString(), lastAt: local(16, 11, 20).toISOString(), reminders: 0 });
    expect(tracking.mail).toEqual({ opens: 2, firstAt: local(16, 13, 5).toISOString(), lastAt: local(17, 8, 54).toISOString(), inferred: false });
    expect(tracking.views).toEqual({ count: 2, firstAt: local(17, 8, 55).toISOString(), lastAt: local(17, 19, 40).toISOString(), fromMail: 1, devices: ["Windows-PC, Chrome", "iPhone, Safari"] });
    expect(tracking.reading).toEqual({ seconds: 244, depth: 100, reachedEnd: true }); expect(tracking.downloads).toEqual({ count: 0, lastAt: null });
    // Reihenfolge der Einträge ist egal – es zählt der Zeitpunkt
    expect(summarizeContractEvents([...journey].reverse())).toEqual(tracking);
  });
  it("Erinnerungen und PDF-Abrufe zählen mit; der letzte Versand ist die Erinnerung", () => {
    const tracking = summarizeContractEvents([...journey, event("erinnert", local(18, 9, 0)), event("pdf_geladen", local(18, 9, 30))]);
    expect(tracking.sent).toMatchObject({ count: 1, reminders: 1, lastAt: local(18, 9, 0).toISOString() }); expect(tracking.downloads).toEqual({ count: 1, lastAt: local(18, 9, 30).toISOString() });
  });
  it("nach einem neuen Versand zählt nur noch, was mit der neuen Fassung passiert ist", () => {
    const tracking = summarizeContractEvents([...journey, event("abgelehnt", local(17, 20)), event("geaendert", local(18, 9)), event("gesendet", local(18, 10))]);
    expect(tracking.sent).toEqual({ count: 2, firstAt: local(16, 11, 20).toISOString(), lastAt: local(18, 10).toISOString(), reminders: 0 });
    expect(tracking.views.count).toBe(0); expect(tracking.mail.opens).toBe(0); expect(tracking.reading.seconds).toBe(0); expect(trackingLine(tracking, now)).toBe("noch nicht geöffnet");
  });
  it("Link angeklickt, aber kein Zählbild geladen: die E-Mail gilt trotzdem als geöffnet", () => {
    const tracking = summarizeContractEvents([event("gesendet", local(17, 10)), event("angesehen", local(17, 11), { source: "mail", seconds: 30, depth: 40 })]);
    expect(tracking.mail).toMatchObject({ opens: 0, inferred: true }); expect(trackingSteps(tracking, "angesehen", {}, now)[1]).toEqual({ key: "mail", label: "E-Mail geöffnet", state: "done", detail: "geöffnet – am Klick auf den Link erkannt" });
    expect(summarizeContractEvents([event("gesendet", local(17, 10)), event("angesehen", local(17, 11), { source: "link" })]).mail.inferred).toBe(false); // weitergeleiteter Link sagt nichts über die E-Mail
  });
  it("unsinnige Messwerte werden begrenzt", () => {
    const tracking = summarizeContractEvents([event("gesendet", local(17, 10)), event("angesehen", local(17, 11), { seconds: 999_999, depth: 250 }), event("angesehen", local(17, 12), { seconds: -5, depth: -3 })]);
    expect(tracking.reading).toEqual({ seconds: 4 * 3600, depth: 100, reachedEnd: true });
  });
  it("Gerät in Worten", () => {
    expect(deviceLabel(UA_WIN)).toBe("Windows-PC, Chrome"); expect(deviceLabel(UA_IPHONE)).toBe("iPhone, Safari");
    expect(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15")).toBe("Mac, Safari");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0")).toBe("Windows-PC, Edge");
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36")).toBe("Android-Handy, Chrome");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; rv:132.0) Gecko/20100101 Firefox/132.0")).toBe("Windows-PC, Firefox");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)")).toBe("Gmail");
    expect(deviceLabel("Safari 17 · macOS")).toBe("Safari 17 · macOS"); expect(deviceLabel("")).toBeNull(); expect(deviceLabel(null)).toBeNull();
  });
  it("Zeitpunkte in Worten", () => {
    expect(whenText(local(18, 9, 5), now)).toBe("heute, 09:05 Uhr"); expect(whenText(local(17, 19, 40), now)).toBe("gestern, 19:40 Uhr"); expect(whenText(local(16, 11, 20), now)).toBe("16.11.2026, 11:20 Uhr"); expect(whenText(null, now)).toBe("–");
  });
  it("fünf Schritte mit je einem Satz", () => {
    const steps = trackingSteps(summarizeContractEvents(journey), "angesehen", {}, now);
    expect(steps.map((step) => [step.key, step.state])).toEqual([["gesendet", "done"], ["mail", "done"], ["geoeffnet", "done"], ["gelesen", "done"], ["ergebnis", "todo"]]);
    expect(steps.map((step) => step.detail)).toEqual(["16.11.2026, 11:20 Uhr", "2× geöffnet, zuletzt gestern, 08:54 Uhr", "2× geöffnet, zuletzt gestern, 19:40 Uhr – Windows-PC, Chrome und iPhone, Safari", "4 Min gelesen, bis zum Ende", "noch nicht unterschrieben"]);
    const fresh = trackingSteps(summarizeContractEvents([event("gesendet", local(18, 14))]), "gesendet", {}, now);
    expect(fresh.map((step) => step.state)).toEqual(["done", "todo", "todo", "todo", "todo"]); expect(fresh.map((step) => step.detail)).toEqual(["heute, 14:00 Uhr", "noch nicht geöffnet", "noch nicht angeklickt", "–", "noch nicht unterschrieben"]);
    const draft = trackingSteps(EMPTY_TRACKING, "entwurf", {}, now); expect(draft.every((step) => step.state === "todo")).toBe(true); expect(draft[0].detail).toBe("noch nicht gesendet");
    const short = trackingSteps(summarizeContractEvents([event("gesendet", local(18, 10)), event("angesehen", local(18, 11), { seconds: 6, depth: 10 })]), "angesehen", {}, now);
    expect(short[3]).toEqual({ key: "gelesen", label: "Gelesen", state: "todo", detail: "nur kurz angesehen" });
    const signed = trackingSteps(summarizeContractEvents(journey), "unterschrieben", { signedAt: local(18, 9, 41), signerName: "Petra Vogt" }, now);
    expect(signed[4]).toEqual({ key: "ergebnis", label: "Unterschrieben", state: "done", detail: "heute, 09:41 Uhr von Petra Vogt" });
    expect(trackingSteps(summarizeContractEvents(journey), "abgelehnt", { declinedAt: local(18, 9), declineReason: "Preis zu hoch" }, now)[4]).toEqual({ key: "ergebnis", label: "Abgelehnt", state: "warn", detail: "heute, 09:00 Uhr – „Preis zu hoch“" });
    const reminded = trackingSteps(summarizeContractEvents([event("gesendet", local(15, 10)), event("abgelehnt", local(15, 12)), event("gesendet", local(16, 10)), event("erinnert", local(18, 8))]), "gesendet", {}, now);
    expect(reminded[0].detail).toBe("heute, 08:00 Uhr – insgesamt 2× gesendet – 1× erinnert");
  });
  it("eine Zeile für die Übersicht", () => {
    expect(trackingLine(summarizeContractEvents(journey), now)).toBe("2× geöffnet, zuletzt gestern, 19:40 Uhr – 4 Min gelesen");
    expect(trackingLine(summarizeContractEvents(journey.slice(0, 5)), now)).toBe("geöffnet gestern, 08:55 Uhr – 2 Min gelesen");
    expect(trackingLine(summarizeContractEvents(journey.slice(0, 4)), now)).toBe("E-Mail 2× geöffnet, Vertrag noch nicht"); expect(trackingLine(summarizeContractEvents(journey.slice(0, 3)), now)).toBe("E-Mail geöffnet, Vertrag noch nicht");
    expect(trackingLine(summarizeContractEvents(journey.slice(0, 2)), now)).toBe("noch nicht geöffnet");
  });
  it("Tipp für den Vertrieb, solange der Vertrag beim Kunden liegt", () => {
    expect(trackingHint(summarizeContractEvents(journey), "angesehen", now)).toBe("Der Kunde hat den Vertrag schon 2× geöffnet und bis zum Ende gelesen, aber noch nicht unterschrieben. Ein kurzer Anruf lohnt sich jetzt.");
    expect(trackingHint(summarizeContractEvents([event("gesendet", local(18, 10)), event("angesehen", local(18, 11), { seconds: 15, depth: 20 })]), "angesehen", now)).toBe("Der Kunde hat den Vertrag einmal geöffnet. Frag ruhig nach, ob noch etwas unklar ist.");
    expect(trackingHint(summarizeContractEvents([event("gesendet", local(15, 10))]), "gesendet", now)).toBe("Seit 3 Tagen nicht geöffnet. Schick eine Erinnerung oder ruf kurz an – vielleicht ist die E-Mail im Spam gelandet.");
    expect(trackingHint(summarizeContractEvents([event("gesendet", local(18, 10))]), "gesendet", now)).toBeNull(); // gerade erst gesendet
    expect(trackingHint(summarizeContractEvents(journey), "unterschrieben", now)).toBeNull(); expect(trackingHint(summarizeContractEvents(journey), "abgelehnt", now)).toBeNull();
  });
  it("im Nachweis stehen nur die wichtigen Schritte", () => {
    const kinds = proofEvents([...journey, event("unterschrieben", local(18, 9, 41)), event("angesehen", local(18, 9, 42)), event("pdf_geladen", local(18, 9, 43))]).map((item) => item.kind);
    expect(kinds).toEqual(["erstellt", "gesendet", "angesehen", "unterschrieben"]);
  });
  it("Trichter: wie weit die gesendeten Verträge gekommen sind", () => {
    const full = summarizeContractEvents(journey); const mailOnly = summarizeContractEvents(journey.slice(0, 3)); const fresh = summarizeContractEvents(journey.slice(0, 2));
    const funnel = contractFunnel([{ status: "entwurf", tracking: EMPTY_TRACKING }, { status: "gesendet", tracking: fresh }, { status: "gesendet", tracking: mailOnly }, { status: "angesehen", tracking: full }, { status: "unterschrieben", tracking: full }, { status: "unterschrieben", tracking: null }]);
    expect(funnel.sent).toBe(5); expect(funnel.stations.map((station) => [station.key, station.count, station.share])).toEqual([["gesendet", 5, 100], ["mail", 4, 80], ["geoeffnet", 3, 60], ["gelesen", 3, 60], ["ergebnis", 2, 40]]);
    expect(contractFunnel([{ status: "entwurf", tracking: EMPTY_TRACKING }])).toMatchObject({ sent: 0 }); expect(contractFunnel([]).stations.every((station) => station.count === 0 && station.share === null)).toBe(true);
    expect(contractFunnel([{ status: "entwurf", tracking: full }]).sent).toBe(0); // abgelehnt, geändert, wieder Entwurf: liegt nicht mehr beim Kunden
  });
  it("der offene Vertrag, bei dem sich Nachfassen am meisten lohnt", () => {
    const cold = { id: 1, status: "gesendet" as const, tracking: summarizeContractEvents(journey.slice(0, 2)) }; const warm = { id: 2, status: "angesehen" as const, tracking: summarizeContractEvents(journey.slice(0, 5)) }; const hot = { id: 3, status: "angesehen" as const, tracking: summarizeContractEvents(journey) }; const done = { id: 4, status: "unterschrieben" as const, tracking: summarizeContractEvents(journey) };
    expect(hottestOpen([cold, warm, hot, done])?.id).toBe(3); expect(hottestOpen([done])).toBeNull(); expect(hottestOpen([cold])?.id).toBe(1);
  });
  it("Herkunft des Aufrufs aus dem Link", () => {
    expect(sourceOf("1")).toBe("mail"); expect(sourceOf("2")).toBe("erinnerung"); expect(sourceOf(undefined)).toBe("link"); expect(sourceOf("x")).toBe("link"); expect(sourceOf(["1"])).toBe("link");
  });
});
