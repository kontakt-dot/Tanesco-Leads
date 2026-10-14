import { describe, expect, it } from "vitest";
import { SimulationProvider, TwilioProvider, twiml, verifyTwilioSignature } from "./telephony-provider";
import { createHmac } from "node:crypto";

describe("Telefonie-Anbieter", () => {
  it("prüft Twilio-Signaturen (HMAC-SHA1 über URL und sortierte Parameter)", () => {
    const url = "https://leads.example/api/telephony/status?callId=5"; const params = { CallSid: "CA1", CallStatus: "completed" };
    const signature = createHmac("sha1", "token").update(`${url}CallSidCA1CallStatuscompleted`).digest("base64");
    expect(verifyTwilioSignature("token", url, params, signature)).toBe(true);
    expect(verifyTwilioSignature("anderes", url, params, signature)).toBe(false);
    expect(verifyTwilioSignature("token", url, params, undefined)).toBe(false);
  });
  it("baut gültiges TwiML mit maskierten Sonderzeichen", () => {
    const xml = twiml.dialNumber({ to: "+49301234", callerId: "+49309999", record: true, recordingCallbackUrl: "https://x/rec?a=1&b=2", announcement: "Hallo & Willkommen" });
    expect(xml).toContain("<Say language=\"de-DE\""); expect(xml).toContain("Hallo &amp; Willkommen"); expect(xml).toContain("record=\"record-from-answer-dual\""); expect(xml).toContain("a=1&amp;b=2"); expect(xml).toContain("<Number>+49301234</Number>");
    expect(twiml.enqueue({ queueName: "kampagne-3", waitUrl: "https://x/hold" })).toContain("<Enqueue waitUrl=\"https://x/hold\">kampagne-3</Enqueue>");
    expect(twiml.dialClient({ identity: "agent-1-2", record: false })).toContain("<Client>agent-1-2</Client>");
  });
  it("simuliert Nummern und Anrufverläufe deterministisch", async () => {
    const provider = new SimulationProvider();
    const numbers = await provider.searchNumbers({ country: "AT", type: "mobil", limit: 3 });
    expect(numbers).toHaveLength(3); expect(numbers[0].e164.startsWith("+43664")).toBe(true); expect(numbers[0].monthlyPrice).toBe(4.5);
    const human = await provider.originateCall({ to: "+49301234567", from: "+4930999", answerUrl: "", statusCallbackUrl: "", amd: true, reference: "1" });
    const busy = await provider.originateCall({ to: "+49301234562", from: "+4930999", answerUrl: "", statusCallbackUrl: "", amd: true, reference: "2" });
    const machine = await provider.originateCall({ to: "+49301234560", from: "+4930999", answerUrl: "", statusCallbackUrl: "", amd: true, reference: "3" });
    const events = provider.drainEvents();
    expect(events.filter((event) => event.providerCallSid === human.providerCallSid).map((event) => event.payload.CallStatus ?? event.payload.AnsweredBy)).toEqual(["ringing", "in-progress", "human"]);
    expect(events.filter((event) => event.providerCallSid === busy.providerCallSid).map((event) => event.payload.CallStatus)).toEqual(["ringing", "busy"]);
    expect(events.filter((event) => event.providerCallSid === machine.providerCallSid).map((event) => event.payload.CallStatus ?? event.payload.AnsweredBy)).toEqual(["ringing", "in-progress", "machine_end_beep"]);
    provider.finishCall(human.providerCallSid, { durationSeconds: 90, withRecording: true });
    expect(provider.drainEvents().map((event) => event.kind)).toEqual(["status", "recording"]);
  });
  it("erzeugt ein Voice-SDK-Token nur mit API-Schlüssel und TwiML-App", async () => {
    const provider = new TwilioProvider({ accountSid: "AC123", authToken: "t", apiKeySid: "SK1", apiKeySecret: "secret", twimlAppSid: "AP1" });
    const token = await provider.accessToken("agent-1-1");
    const [header, payload] = token!.split(".").slice(0, 2).map((part) => JSON.parse(Buffer.from(part, "base64url").toString()));
    expect(header).toMatchObject({ alg: "HS256", cty: "twilio-fpa;v=1" }); expect(payload).toMatchObject({ iss: "SK1", sub: "AC123", grants: { identity: "agent-1-1", voice: { outgoing: { application_sid: "AP1" } } } });
    expect(await new TwilioProvider({ accountSid: "AC123", authToken: "t" }).accessToken("x")).toBeNull();
  });
  it("übersetzt Nummernsuche und Kauf in Twilio-Aufrufe", async () => {
    const calls: Array<{ url: string; method: string; body: string | null }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => { calls.push({ url, method: init?.method ?? "GET", body: init?.body ? String(init.body) : null }); if (url.includes("pricing.twilio.com")) return new Response(JSON.stringify({ price_unit: "USD", phone_number_prices: [{ number_type: "local", current_price: "1.15" }] }), { status: 200 }); if (url.includes("AvailablePhoneNumbers")) return new Response(JSON.stringify({ available_phone_numbers: [{ phone_number: "+493012345", friendly_name: "+49 30 12345", locality: "Berlin", capabilities: { voice: true, SMS: false } }] }), { status: 200 }); if (url.endsWith("IncomingPhoneNumbers.json")) return new Response(JSON.stringify({ sid: "PN1", phone_number: "+493012345", friendly_name: "Tanesco DE" }), { status: 201 }); return new Response("{}", { status: 200 }); }) as typeof fetch;
    const provider = new TwilioProvider({ accountSid: "AC123", authToken: "tok" }, fetchImpl);
    const found = await provider.searchNumbers({ country: "DE", type: "lokal", contains: "30" });
    expect(found).toEqual([{ e164: "+493012345", friendlyName: "+49 30 12345", region: "Berlin", type: "lokal", monthlyPrice: 1.15, currency: "USD", capabilities: { voice: true, sms: false } }]);
    expect(calls[0].url).toContain("/AvailablePhoneNumbers/DE/Local.json?VoiceEnabled=true&PageSize=20&Contains=30");
    const bought = await provider.purchaseNumber("+493012345", { friendlyName: "Tanesco DE", voiceUrl: "https://x/voice", statusCallbackUrl: "https://x/status", country: "DE", addressSid: "AD1", bundleSid: "BU1" });
    expect(bought).toEqual({ providerSid: "PN1", e164: "+493012345", friendlyName: "Tanesco DE" });
    expect(calls[2].body).toContain("PhoneNumber=%2B493012345"); expect(calls[2].body).toContain("BundleSid=BU1"); expect(calls[2].body).toContain("AddressSid=AD1");
  });
});
