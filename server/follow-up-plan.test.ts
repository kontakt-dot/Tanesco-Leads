import { describe, expect, it } from "vitest";
import { DEFAULT_SEND_WINDOW, type EmailTree, type SendWindow } from "../shared/email-campaigns";
import { nextEmailOf, planDayKey, planFollowUps, windowIntervals, type PlanCampaign, type PlanRecipient } from "../shared/follow-up-plan";

// Mittwoch, 28.10.2026, 10:18 Uhr deutscher Zeit (Winterzeit: UTC+1)
const now = new Date("2026-10-28T09:18:00Z");
const berlin = (local: string) => new Date(`${local}+01:00`); // „2026-10-29T09:00“ → deutsche Zeit
const tree: EmailTree = { start: "s1", nodes: [
  { id: "s1", type: "send", label: "1. E-Mail", subject: "Hallo", blocks: [{ type: "text", text: "x" } as never], next: "w1" },
  { id: "w1", type: "wait", hours: 72, next: "c1" },
  { id: "c1", type: "condition", check: "opened", yes: "s2", no: "s3" },
  { id: "s2", type: "send", label: "Wenn geöffnet", subject: "Kurze Frage", blocks: [{ type: "text", text: "x" } as never], next: "w2" },
  { id: "s3", type: "send", label: "Wenn nicht geöffnet", subject: "Gesehen?", blocks: [{ type: "text", text: "x" } as never], next: "w2" },
  { id: "w2", type: "wait", hours: 96, next: "e1" },
  { id: "e1", type: "end", label: "Ende" },
] };
const drip = (perHour: number | null): SendWindow => ({ ...DEFAULT_SEND_WINDOW, drip: perHour ? { enabled: true, perHour, gapSeconds: 90 } : { enabled: false, perHour: 40, gapSeconds: 90 } });
let nextId = 1;
const waiting = (until: Date, extra: Partial<PlanRecipient> = {}): PlanRecipient => ({ id: nextId++, nodeId: "w1", status: "wartet", sentCount: 1, nextActionAt: until, lastSentAt: new Date(until.getTime() - 72 * 3_600_000), sentNodeIds: ["s1"], ...extra });
const campaign = (id: number, recipients: PlanRecipient[], extra: Partial<PlanCampaign> = {}): PlanCampaign => ({ id, status: "aktiv", tree, window: drip(12), stopOnReply: true, approval: false, recipients, ...extra });
const plan = (campaigns: PlanCampaign[], todayLeft = 80, dailyLimit = 80) => planFollowUps(campaigns, { now, todayLeft, dailyLimit });
const hm = (value: Date) => value.toLocaleTimeString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });

describe("Wann gehen die nächsten Follow-ups raus?", () => {
  it("Versandfenster: Wartezeit endet vor 9 Uhr → Do 09:00; endet Freitagabend → Montag 09:00", () => {
    const result = plan([campaign(1, [waiting(berlin("2026-10-29T08:00"))]), campaign(2, [waiting(berlin("2026-10-30T17:00"))])]);
    expect(result.get(1)!.days[0]).toMatchObject({ day: "2026-10-29", count: 1 }); expect(hm(result.get(1)!.days[0].first)).toBe("09:00");
    expect(result.get(2)!.days[0].day).toBe("2026-11-02"); expect(hm(result.get(2)!.days[0].first)).toBe("09:00");
  });
  it("Wie der Zeitplaner: aus der Mittagspause im Viertelstunden-Raster ins nächste Fenster", () => {
    const result = plan([campaign(1, [waiting(berlin("2026-10-29T11:40"))])]);
    expect(hm(result.get(1)!.days[0].first)).toBe("14:10"); // 11:40 + 10 × 15 Min.
  });
  it("Drip 12 pro Stunde: 30 fällige Follow-ups verteilen sich über den Tag (bis 11:30, ab 14:00)", () => {
    const due = berlin("2026-10-29T10:00"); const result = plan([campaign(1, Array.from({ length: 30 }, () => waiting(due)))]);
    const day = result.get(1)!.days[0]; expect(day).toMatchObject({ day: "2026-10-29", count: 30 }); expect(hm(day.first)).toBe("10:00"); expect(hm(day.last)).toBe("14:55");
    expect(result.get(1)!.total).toBe(30); expect(result.get(1)!.perHour).toBe(12);
  });
  it("Tageslimit gilt für alle Kampagnen zusammen: 2 × 50 fällig, Limit 80 → 80 am Donnerstag, 20 am Freitag", () => {
    const due = berlin("2026-10-29T09:00");
    const result = plan([campaign(1, Array.from({ length: 50 }, () => waiting(due)), { window: drip(null) }), campaign(2, Array.from({ length: 50 }, () => waiting(due)), { window: drip(null) })]);
    const all = [...result.get(1)!.days, ...result.get(2)!.days]; const sum = (day: string) => all.filter((item) => item.day === day).reduce((total, item) => total + item.count, 0);
    expect(sum("2026-10-29")).toBe(80); expect(sum("2026-10-30")).toBe(20);
    expect(result.get(1)!.delayedByLimit || result.get(2)!.delayedByLimit).toBe(true);
  });
  it("heute ist das Limit schon voll → was heute fällig ist, geht morgen raus", () => {
    const result = plan([campaign(1, [waiting(berlin("2026-10-28T14:00"))])], 0);
    expect(result.get(1)!.days[0].day).toBe("2026-10-29"); expect(result.get(1)!.delayedByLimit).toBe(true);
  });
  it("kein Follow-up: geantwortet (Antwort-Stopp), letzte Wartezeit vor dem Ende, beendet; Erst-E-Mails zählen nicht als Follow-up", () => {
    const result = plan([campaign(1, [
      waiting(berlin("2026-10-29T09:00"), { repliedAt: berlin("2026-10-27T12:00") }),
      waiting(berlin("2026-10-29T09:00"), { nodeId: "w2", sentCount: 2, sentNodeIds: ["s1", "s3"] }),
      waiting(berlin("2026-10-29T09:00"), { status: "fertig" }),
      { id: nextId++, nodeId: null, status: "wartet", sentCount: 0, nextActionAt: null, lastSentAt: null },
    ])]);
    expect(result.get(1)!.total).toBe(0); expect(result.get(1)!.days).toEqual([]);
  });
  it("Wenn-Abfrage mit dem heutigen Stand: geöffnet → „Wenn geöffnet“, sonst die andere E-Mail; schon gesendete E-Mail wird übersprungen", () => {
    const opened = waiting(berlin("2026-10-29T09:00"), { openedAt: berlin("2026-10-27T10:00") });
    expect(nextEmailOf(tree, opened, now.getTime())?.nodeId).toBe("s2");
    expect(nextEmailOf(tree, waiting(berlin("2026-10-29T09:00")), now.getTime())?.nodeId).toBe("s3");
    expect(nextEmailOf(tree, waiting(berlin("2026-10-29T09:00"), { sentNodeIds: ["s1", "s3"] }), now.getTime())).toBeNull(); // s3 schon da → weiter zu w2 → Ende
  });
  it("„Jede E-Mail freigeben“: Follow-ups stehen ab dem Zeitpunkt zur Freigabe an und gehen nicht von allein raus", () => {
    const result = plan([campaign(1, [waiting(berlin("2026-10-29T09:00")), waiting(berlin("2026-10-30T09:00")), waiting(berlin("2026-10-29T09:00"), { draftState: "freigegeben", draftNodeId: "s3" })], { approval: true })]);
    const one = result.get(1)!; expect(one.approval).toMatchObject({ count: 2 }); expect(hm(one.approval!.first!)).toBe("09:00"); expect(planDayKey(one.approval!.first!)).toBe("2026-10-29");
    expect(one.days).toHaveLength(1); expect(one.days[0].count).toBe(1); // der freigegebene geht raus
  });
  it("pausiert: keine Zeiten, aber die Zahl der wartenden Follow-ups", () => {
    const result = plan([campaign(1, [waiting(berlin("2026-10-29T09:00")), waiting(berlin("2026-10-29T09:00"))], { status: "pausiert" })]);
    expect(result.get(1)).toMatchObject({ paused: true, total: 2, days: [] });
  });
  it("fällige Erst-E-Mails verbrauchen das Tageslimit mit (älteste zuerst)", () => {
    const first = Array.from({ length: 79 }, () => ({ id: nextId++, nodeId: null, status: "wartet", sentCount: 0, nextActionAt: null, lastSentAt: null }) as PlanRecipient);
    const result = plan([campaign(1, [...first, waiting(berlin("2026-10-28T10:00"))], { window: drip(null) })], 79);
    expect(result.get(1)!.days[0].day).toBe("2026-10-29"); // die 79 Erst-E-Mails füllen heute
  });
  it("Fenster mit Ausnahme je Wochentag und Mittagspause als feste Zeiträume", () => {
    const window: SendWindow = { ...DEFAULT_SEND_WINDOW, days: { "5": { from: "09:00", to: "11:00" } } }; // freitags nur bis 11 Uhr
    const intervals = windowIntervals(window, now.getTime(), 3).map(([start, end]) => `${planDayKey(start)} ${hm(new Date(start))}–${hm(new Date(end))}`);
    expect(intervals).toContain("2026-10-29 09:00–11:30"); expect(intervals).toContain("2026-10-29 14:00–16:30");
    expect(intervals).toContain("2026-10-30 09:00–11:00"); expect(intervals.filter((item) => item.startsWith("2026-10-30"))).toHaveLength(1);
    expect(intervals.some((item) => item.startsWith("2026-10-31"))).toBe(false); // Samstag: kein Versand
  });
});
