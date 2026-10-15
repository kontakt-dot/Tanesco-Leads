import { describe, expect, it } from "vitest";
import { parseSipgateEvent, sameNumber, SipgateProvider, sipgateResponseXml, sipgateStatusOf } from "./sipgate-provider";

/** Nachgebaute sipgate-API: merkt sich alle Aufrufe und antwortet je Pfad. */
function fakeSipgate(options: { system?: "classic" | "neo"; activeCalls?: Array<{ callId: string; participants: Array<{ phoneNumber: string }> }>; history?: Array<Record<string, unknown>> } = {}) {
  const calls: Array<{ method: string; path: string; body: unknown; auth: string | null }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); const path = url.replace("https://api.sipgate.com/v2", "");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ method: init?.method ?? "GET", path, body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: headers.authorization ?? null });
    const json = (status: number, body: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (path === "/authorization/userinfo") return json(200, { sub: "3376511w0", masterSipId: "3376511", domain: "sipgate.de" });
    if (path === "/channels") return options.system === "neo" ? json(200, { items: [{ id: "c1", name: "Vertrieb" }] }) : json(404, { message: "not found" });
    if (path === "/w0/devices") return json(200, { items: [{ id: "e0", alias: "sipgate App", type: "REGISTER", online: true, dnd: false }, { id: "x0", alias: "Handy", type: "EXTERNAL" }] });
    if (path === "/numbers") return json(200, { items: [{ id: "1", number: "+496119851230", localized: "0611 9851230", type: "LANDLINE", endpointAlias: "Zentrale" }, { id: "2", number: "+4917833591460", localized: "0178 …", type: "MOBILE" }, { id: "3", number: "*55", type: "QUICKDIAL" }] });
    if (path === "/sessions/calls" || path === "/calls" && init?.method === "POST") return json(200, { sessionId: "sess-1" });
    if (path === "/calls") return json(200, { data: options.activeCalls ?? [] });
    if (/^\/calls\/[^/]+\/recording$/.test(path)) return json(204, undefined);
    if (/^\/calls\/[^/]+$/.test(path) && init?.method === "DELETE") return json(204, undefined);
    if (path === "/sessions/sms") return json(204, undefined);
    if (path.startsWith("/history")) return json(200, { items: options.history ?? [] });
    if (path === "/channels/c1/events?limit=50") return json(200, { items: options.history ?? [] });
    if (path === "/settings/sipgateio" && init?.method === "GET") return json(200, { incomingUrl: "", outgoingUrl: "https://leads.example/api/telephony/sipgate/events?tenant=1&secret=x", log: true, whitelist: null });
    if (path === "/settings/sipgateio") return json(204, undefined);
    return json(404, { message: `unbekannt: ${path}` });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}
const creds = { tokenId: "token-abc", token: "geheim" };
const fast = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.min(ms, 1)));

describe("sipgate-Anbieter", () => {
  it("meldet sich mit Basic-Auth aus Token-ID und Token, erkennt Benutzer, System, Geräte und Rufnummern", async () => {
    const api = fakeSipgate();
    const provider = new SipgateProvider(creds, { fetchImpl: api.fetchImpl });
    expect(await provider.userInfo()).toEqual({ userId: "w0", masterSipId: "3376511", domain: "sipgate.de" });
    expect(api.calls[0].auth).toBe(`Basic ${Buffer.from("token-abc:geheim").toString("base64")}`);
    expect(await provider.detectSystem()).toBe("classic");
    expect(await new SipgateProvider(creds, { fetchImpl: fakeSipgate({ system: "neo" }).fetchImpl }).detectSystem()).toBe("neo");
    const devices = await provider.devices("w0"); expect(devices).toHaveLength(2); expect(devices[0]).toMatchObject({ id: "e0", alias: "sipgate App", online: true });
    const numbers = await provider.numbers(); expect(numbers.map((number) => number.e164)).toEqual(["+496119851230", "+4917833591460"]); // Kurzwahl bleibt draußen
  });
  it("Click-to-Dial: classic über /sessions/calls, neo über /calls – mit Gerät, Zielnummer und angezeigter Rufnummer; die callId kommt aus der Liste der aktiven Anrufe", async () => {
    const api = fakeSipgate({ activeCalls: [{ callId: "CALL-77", participants: [{ phoneNumber: "+49151999888" }] }] });
    const provider = new SipgateProvider(creds, { fetchImpl: api.fetchImpl, deviceId: "e0" });
    provider.findCallId = (to, seconds) => SipgateProvider.prototype.findCallId.call(provider, to, seconds, fast);
    const result = await provider.originateCall({ to: "+49151999888", from: "+49 611 9851230", answerUrl: "", statusCallbackUrl: "", amd: false, reference: "1" });
    expect(result).toEqual({ providerCallSid: "CALL-77", providerSessionId: "sess-1" });
    expect(api.calls[0]).toMatchObject({ method: "POST", path: "/sessions/calls", body: { deviceId: "e0", caller: "e0", callee: "+49151999888", callerId: "+496119851230" } });
    const neoApi = fakeSipgate({ system: "neo", activeCalls: [] });
    const neo = new SipgateProvider(creds, { fetchImpl: neoApi.fetchImpl, system: "neo" });
    neo.findCallId = (to, seconds) => SipgateProvider.prototype.findCallId.call(neo, to, seconds, fast);
    const pending = await neo.originateCall({ to: "+49151999888", from: "+496119851230", answerUrl: "", statusCallbackUrl: "", amd: false, reference: "2", deviceId: "e1", timeoutSeconds: 0 });
    expect(neoApi.calls[0]).toMatchObject({ method: "POST", path: "/calls", body: { deviceId: "e1" } });
    expect(pending.providerCallSid).toBe("session:sess-1"); // noch nicht in der Liste → später per Abgleich/Webhook
    await expect(new SipgateProvider(creds, { fetchImpl: api.fetchImpl }).originateCall({ to: "+49151", from: "+49", answerUrl: "", statusCallbackUrl: "", amd: false, reference: "3" })).rejects.toThrow(/Kein sipgate-Gerät/);
  });
  it("auflegen, Aufzeichnung (mit/ohne sipgate-Ansage) und SMS gehen über die passenden Endpunkte; WhatsApp geht nicht", async () => {
    const api = fakeSipgate();
    const provider = new SipgateProvider(creds, { fetchImpl: api.fetchImpl, smsId: "s3" });
    await provider.hangupCall("CALL-1"); expect(api.calls.at(-1)).toMatchObject({ method: "DELETE", path: "/calls/CALL-1" });
    await provider.hangupCall("session:abc"); expect(api.calls).toHaveLength(1); // ohne callId nichts zu tun
    expect(await provider.startRecording("CALL-1", "", { announcement: true })).toEqual({ recordingSid: "sg-CALL-1" });
    expect(api.calls.at(-1)).toMatchObject({ method: "PUT", path: "/calls/CALL-1/recording", body: { value: true, announcement: true } });
    await expect(provider.startRecording("pending:1", "")).rejects.toThrow(/noch nicht bekannt/);
    expect((await provider.sendMessage({ channel: "sms", from: "+49611", to: "+49151999888", body: "Hallo" })).status).toBe("gesendet");
    expect(api.calls.at(-1)).toMatchObject({ method: "POST", path: "/sessions/sms", body: { smsId: "s3", recipient: "+49151999888", message: "Hallo" } });
    await expect(provider.sendMessage({ channel: "whatsapp", from: "+49611", to: "+49151", body: "x" })).rejects.toThrow(/WhatsApp/);
    await expect(provider.searchNumbers({ country: "DE", type: "lokal" })).rejects.toThrow(/direkt bei sipgate/);
  });
  it("Fehler kommen in Klartext mit Hinweis (401 Token, 403 Rechte)", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ message: "Unauthorized" }), { status: 401 })) as unknown as typeof fetch;
    await expect(new SipgateProvider(creds, { fetchImpl }).userInfo()).rejects.toThrow(/HTTP 401.*Token-ID oder Token stimmen nicht/);
    const forbidden = (async () => new Response("", { status: 403 })) as unknown as typeof fetch;
    await expect(new SipgateProvider(creds, { fetchImpl: forbidden }).numbers()).rejects.toThrow(/Rechte \(Scopes\)/);
  });
  it("Verlauf: Dauer in Sekunden oder Millisekunden, Aufzeichnung aus recordingUrl (classic) oder recordings[] (neo)", async () => {
    const now = new Date("2026-10-15T10:00:00Z");
    const classic = new SipgateProvider(creds, { fetchImpl: fakeSipgate({ history: [{ id: "h1", source: "+496119851230", target: "+49151999888", created: now.toISOString(), duration: 183000, status: "PICKUP", direction: "OUTGOING", recordingUrl: "https://api.sipgate.com/v2/history/h1/recording" }] }).fetchImpl });
    const entries = await classic.history({ since: new Date(now.getTime() - 60_000), until: new Date(now.getTime() + 60_000) });
    expect(entries[0]).toMatchObject({ id: "h1", target: "+49151999888", durationSeconds: 183, recordingUrl: "https://api.sipgate.com/v2/history/h1/recording" });
    const neo = new SipgateProvider(creds, { system: "neo", fetchImpl: fakeSipgate({ system: "neo", history: [{ id: "ev1", target: "+49151999888", created: now.toISOString(), duration: 95, recordings: [{ url: "https://files.sipgate.com/rec/ev1.mp3" }] }, { id: "alt", target: "+49151", created: "2020-01-01T00:00:00Z", duration: 5 }] }).fetchImpl });
    const events = await neo.history({ since: new Date(now.getTime() - 60_000), until: new Date(now.getTime() + 60_000) });
    expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ id: "ev1", durationSeconds: 95, recordingUrl: "https://files.sipgate.com/rec/ev1.mp3" });
  });
  it("Push-API: Ereignisse lesen, auf Dialer-Status abbilden, Antwort-XML mit onAnswer/onHangup", () => {
    const newCall = parseSipgateEvent({ event: "newCall", callId: "C1", direction: "out", from: "+496119851230", to: "+49151999888", "user[]": ["Taner"], "userId[]": ["w0"], xcid: "x" });
    expect(newCall).toMatchObject({ event: "newCall", callId: "C1", direction: "out", to: "+49151999888", userIds: ["w0"] });
    expect(sipgateStatusOf(newCall)).toBe("ringing");
    expect(sipgateStatusOf(parseSipgateEvent({ event: "answer", callId: "C1", direction: "out", to: "+49151999888", answeringNumber: "+49151999888" }))).toBe("in-progress");
    expect(sipgateStatusOf(parseSipgateEvent({ event: "hangup", callId: "C1", cause: "normalClearing" }))).toBe("completed");
    expect(sipgateStatusOf(parseSipgateEvent({ event: "hangup", callId: "C1", cause: "busy" }))).toBe("busy");
    expect(sipgateStatusOf(parseSipgateEvent({ event: "hangup", callId: "C1", cause: "noAnswer" }))).toBe("no-answer");
    expect(sipgateStatusOf(parseSipgateEvent({ event: "hangup", callId: "C1", cause: "cancel" }))).toBe("canceled");
    expect(sipgateStatusOf(parseSipgateEvent({ event: "hangup", callId: "C1", cause: "notFound" }))).toBe("failed");
    expect(sipgateStatusOf(parseSipgateEvent({ event: "dtmf", callId: "C1", dtmf: "1" }))).toBeNull();
    expect(sipgateResponseXml({ onAnswer: "https://x.de/a?secret=1&tenant=2", onHangup: "https://x.de/h" })).toBe(`<?xml version="1.0" encoding="UTF-8"?><Response onAnswer="https://x.de/a?secret=1&amp;tenant=2" onHangup="https://x.de/h" />`);
    expect(sameNumber("+49 151 999888", "0151999888")).toBe(true); expect(sameNumber("+49151999888", "+49151999889")).toBe(false); expect(sameNumber("", "+49151")).toBe(false);
  });
  it("liest und schreibt die Webhook-Einstellungen (sipgate.io)", async () => {
    const api = fakeSipgate();
    const provider = new SipgateProvider(creds, { fetchImpl: api.fetchImpl });
    expect(await provider.webhookSettings()).toMatchObject({ outgoingUrl: "https://leads.example/api/telephony/sipgate/events?tenant=1&secret=x", log: true });
    await provider.saveWebhookSettings({ incomingUrl: "https://leads.example/e", outgoingUrl: "https://leads.example/e" });
    expect(api.calls.at(-1)).toMatchObject({ method: "PUT", path: "/settings/sipgateio", body: { incomingUrl: "https://leads.example/e", outgoingUrl: "https://leads.example/e", log: true, whitelist: null } });
  });
});
