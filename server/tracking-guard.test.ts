import { describe, expect, it } from "vitest";
import { isMachineRequest, isTooSoonAfterSend } from "../shared/tracking-guard";
import { campaignMailStats } from "../shared/sent-tracking";

describe("Tracking-Schutz", () => {
  it("erkennt Scanner, leere Kennung und HEAD – Gmail-Proxy und echte Browser zählen", () => {
    expect(isMachineRequest({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)", method: "GET" })).toBe(false);
    expect(isMachineRequest({ userAgent: "Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)" })).toBe(false);
    expect(isMachineRequest({ userAgent: "Microsoft Office/16.0 (Windows NT 10.0; Microsoft Outlook 16.0)" })).toBe(false);
    for (const ua of ["", "python-requests/2.31", "Barracuda Sentinel", "Mozilla/5.0 (compatible; bingbot/2.0)", "Slackbot-LinkExpanding 1.0", "curl/8.1"]) expect(isMachineRequest({ userAgent: ua })).toBe(true);
    expect(isMachineRequest({ userAgent: "Mozilla/5.0", method: "HEAD" })).toBe(true);
    expect(isMachineRequest(undefined)).toBe(false);
  });
  it("Aufrufe in den ersten 5 Sekunden nach dem Versand sind Maschinen", () => {
    const now = new Date("2026-10-19T12:00:10Z");
    expect(isTooSoonAfterSend(new Date("2026-10-19T12:00:07Z"), now)).toBe(true);
    expect(isTooSoonAfterSend(new Date("2026-10-19T12:00:00Z"), now)).toBe(false);
    expect(isTooSoonAfterSend(null, now)).toBe(false);
  });
  it("zählt je Mail: eine Person, zwei geöffnete Mails; Antworten sind keine Öffnungs-Ereignisse, beweisen aber das Lesen", () => {
    const t = (m: number) => new Date(Date.UTC(2026, 9, 19, 9, m));
    const stats = campaignMailStats([
      { recipientId: 1, kind: "gesendet", createdAt: t(0) }, { recipientId: 1, kind: "geoeffnet", note: "E-Mail geöffnet", createdAt: t(5) },
      { recipientId: 1, kind: "gesendet", createdAt: t(30) }, { recipientId: 1, kind: "geoeffnet", note: "E-Mail geöffnet", createdAt: t(35) }, { recipientId: 1, kind: "geoeffnet", note: "E-Mail geöffnet", createdAt: t(36) },
      { recipientId: 2, kind: "gesendet", createdAt: t(0) },
      { recipientId: 3, kind: "gesendet", createdAt: t(0) }, { recipientId: 3, kind: "geoeffnet", note: "Antwort im Postfach erkannt: „Re: Hallo“", createdAt: t(50) },
    ]);
    expect(stats).toEqual({ sent: 4, opened: 3, clicked: 0, replied: 1 });
  });
});
