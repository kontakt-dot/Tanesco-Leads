import { describe, expect, it } from "vitest";
import { inTimeOfDay, summarizeSent, type SentReaction, type SentTracking } from "../shared/sent-tracking";

const tracking = (reaction: SentReaction): SentTracking => ({ openedAt: reaction === "geoeffnet" ? new Date("2026-10-27T12:00:00Z") : null, clickedAt: null, repliedAt: null, bouncedAt: null, unsubscribedAt: null, reaction });
type Row = { id: string; kind: string; campaignId: number | null; campaignName: string | null; at: Date; to: string; name: string | null; subject: string; tracking: SentTracking | null; origin: { source: "ki" | "hand" | "vorlage" | "entwurf-vorlage" } | null };
const mail = (id: string, at: string, extra: Partial<Row> = {}): Row => ({ id, kind: "kampagne", campaignId: 1, campaignName: "Dach", at: new Date(at), to: `${id}@zeit.example`, name: null, subject: "Hallo", tracking: tracking("ohne"), origin: { source: "ki" }, ...extra });

// Oktober 2026: bis So 25.10. Sommerzeit (UTC+2), danach Winterzeit (UTC+1)
const items: Row[] = [
  mail("e", "2026-10-27T10:00:00Z", { kind: "einzel", campaignId: null, campaignName: null, tracking: null, origin: null }), // Di 11:00 Einzel-E-Mail
  mail("d", "2026-10-27T08:45:00Z", { campaignId: 2, campaignName: "Solar", tracking: tracking("geoeffnet") }), // Di 09:45
  mail("c", "2026-10-26T16:00:00Z"), // Mo 17:00
  mail("b", "2026-10-26T13:05:00Z", { tracking: tracking("geoeffnet"), origin: { source: "vorlage" } }), // Mo 14:05
  mail("a", "2026-10-26T08:10:00Z"), // Mo 09:10
];
const ids = (result: { items: Row[] }) => result.items.map((item) => item.id);

describe("Gesendet: Filter nach Datum und Uhrzeit", () => {
  it("Uhrzeit gilt in deutscher Zeit – auch über die Zeitumstellung, „bis“ zählt mit, über Mitternacht geht", () => {
    expect(inTimeOfDay(new Date("2026-10-20T07:00:00Z"), "09:00", "11:30")).toBe(true); // 09:00 Sommerzeit
    expect(inTimeOfDay(new Date("2026-10-20T06:59:00Z"), "09:00", "11:30")).toBe(false); // 08:59
    expect(inTimeOfDay(new Date("2026-10-20T09:30:40Z"), "09:00", "11:30")).toBe(true); // 11:30:40 – zählt noch mit
    expect(inTimeOfDay(new Date("2026-10-20T09:31:00Z"), "09:00", "11:30")).toBe(false); // 11:31
    expect(inTimeOfDay(new Date("2026-10-27T08:00:00Z"), "09:00", "11:30")).toBe(true); // 09:00 Winterzeit
    expect(inTimeOfDay(new Date("2026-10-27T07:30:00Z"), "09:00", "11:30")).toBe(false); // 08:30 Winterzeit
    expect(inTimeOfDay(new Date("2026-10-20T21:00:00Z"), "22:00", "06:00")).toBe(true); // 23:00
    expect(inTimeOfDay(new Date("2026-10-21T03:30:00Z"), "22:00", "06:00")).toBe(true); // 05:30
    expect(inTimeOfDay(new Date("2026-10-20T19:00:00Z"), "22:00", "06:00")).toBe(false); // 21:00
    expect(inTimeOfDay(new Date("2026-10-20T12:00:00Z"), "14:00", null)).toBe(true); // 14:00 – nur „ab“
    expect(inTimeOfDay(new Date("2026-10-20T11:59:00Z"), "14:00", null)).toBe(false);
    expect(inTimeOfDay(new Date("2026-10-20T09:30:00Z"), null, "11:30")).toBe(true); // nur „bis“
    expect(inTimeOfDay(new Date("2026-10-20T10:00:00Z"), null, null)).toBe(true);
  });

  it("Tag, Zeitraum und Uhrzeit filtern Liste und Zähler gemeinsam", () => {
    const dienstag = summarizeSent(items, { from: new Date("2026-10-26T23:00:00Z") }); // ab Di 00:00
    expect(ids(dienstag)).toEqual(["e", "d"]); expect(dienstag.counts).toEqual({ alle: 2, kampagne: 1, antwort: 0, einzel: 1 });
    expect(dienstag.campaigns).toEqual([{ id: 2, name: "Solar", count: 1 }]);
    const vormittags = summarizeSent(items, { timeFrom: "09:00", timeTo: "11:30" });
    expect(ids(vormittags)).toEqual(["e", "d", "a"]); expect(vormittags.reactions.geoeffnet).toBe(1); expect(vormittags.total).toBe(3);
    // eigener Zeitraum Mo 09:00 bis Mo 14:05 (die Oberfläche schickt „bis“ + 1 Minute) → a und b; mit Reaktion „geöffnet“ nur b
    const eigener = summarizeSent(items, { from: new Date("2026-10-26T08:00:00Z"), to: new Date("2026-10-26T13:06:00Z"), reaction: "geoeffnet" });
    expect(ids(eigener)).toEqual(["b"]); expect(eigener.total).toBe(1); expect(eigener.counts.alle).toBe(2); expect(eigener.origins).toMatchObject({ vorlage: 1, ki: 0 });
    // „bis“ genau zur Sendezeit → nicht dabei
    expect(ids(summarizeSent(items, { from: new Date("2026-10-26T08:00:00Z"), to: new Date("2026-10-26T13:05:00Z") }))).toEqual(["a"]);
    // Zeitraum + Uhrzeit: Montag nachmittags
    expect(ids(summarizeSent(items, { from: new Date("2026-10-25T23:00:00Z"), to: new Date("2026-10-26T23:00:00Z"), timeFrom: "14:00", timeTo: "16:30" }))).toEqual(["b"]);
  });

  it("Kampagne gewählt: Liste nur diese Kampagne, Auswahlliste aus der Übersicht bleibt vollständig; Liste auf 200 begrenzt, Gesamtzahl stimmt", () => {
    const own = items.filter((item) => item.campaignId === 1);
    const overview = items.filter((item) => item.campaignId).map((item) => ({ campaignId: item.campaignId!, name: item.campaignName!, at: item.at }));
    const result = summarizeSent(own, { campaignId: 1, timeFrom: "09:00", timeTo: "16:30" }, { overview });
    expect(ids(result)).toEqual(["b", "a"]); expect(result.campaigns.map((item) => [item.name, item.count])).toEqual([["Dach", 2], ["Solar", 1]]);
    const many = Array.from({ length: 250 }, (_, i) => mail(`m${i}`, new Date(Date.UTC(2026, 9, 26, 8, 0) - i * 60_000).toISOString()));
    const capped = summarizeSent(many, {}); expect(capped.items).toHaveLength(200); expect(capped.total).toBe(250); expect(capped.counts.kampagne).toBe(250);
  });
});
