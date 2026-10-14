/**
 * Telefonie-Anbieter hinter dem Dialer.
 *  - twilio: Rufnummern (DE/AT/CH) suchen und kaufen, Anrufe aufbauen, Browser-Softphone (Voice SDK), Aufzeichnung.
 *  - simulation: gleiches Verhalten ohne echte Telefonie (Chat-Build, Tests, Einrichtung ohne Konto).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { SignJWT } from "jose";
import { nanoid } from "nanoid";

export type NumberSearch = { country: "DE" | "AT" | "CH"; type: "lokal" | "mobil" | "national" | "kostenfrei"; contains?: string; region?: string; limit?: number };
export type AvailableNumber = { e164: string; friendlyName: string; region: string | null; type: NumberSearch["type"]; monthlyPrice: number | null; currency: string; capabilities: { voice: boolean; sms: boolean } };
export type PurchasedNumber = { providerSid: string; e164: string; friendlyName: string };
export type OriginateInput = { to: string; from: string; answerUrl: string; statusCallbackUrl: string; amd: boolean; amdCallbackUrl?: string; timeoutSeconds?: number; reference: string };
export type OriginateResult = { providerCallSid: string };

export interface TelephonyProvider {
  readonly name: "twilio" | "simulation";
  searchNumbers(search: NumberSearch): Promise<AvailableNumber[]>;
  purchaseNumber(e164: string, options: { friendlyName: string; voiceUrl: string; statusCallbackUrl: string; country: string; addressSid?: string | null; bundleSid?: string | null }): Promise<PurchasedNumber>;
  releaseNumber(providerSid: string): Promise<void>;
  originateCall(input: OriginateInput): Promise<OriginateResult>;
  hangupCall(providerCallSid: string): Promise<void>;
  redirectCall(providerCallSid: string, twimlUrl: string): Promise<void>;
  startRecording(providerCallSid: string, callbackUrl: string): Promise<{ recordingSid: string }>;
  accessToken(identity: string, ttlSeconds?: number): Promise<string | null>;
  /** Textnachricht (SMS oder WhatsApp) senden; from/to in E.164. */
  sendMessage(input: MessageInput): Promise<MessageResult>;
}
export type MessageInput = { channel: "sms" | "whatsapp"; from: string; to: string; body: string; statusCallbackUrl?: string };
export type MessageResult = { providerMessageSid: string; status: "gesendet" | "simuliert" };

/* ------------------------------------------------------------------ Twilio */

export type TwilioCredentials = { accountSid: string; authToken: string; apiKeySid?: string; apiKeySecret?: string; twimlAppSid?: string };
const TYPE_MAP: Record<NumberSearch["type"], string> = { lokal: "Local", mobil: "Mobile", national: "National", kostenfrei: "TollFree" };

export class TwilioProvider implements TelephonyProvider {
  readonly name = "twilio" as const;
  constructor(private readonly credentials: TwilioCredentials, private readonly fetchImpl: typeof fetch = fetch) {}
  private get base() { return `https://api.twilio.com/2010-04-01/Accounts/${this.credentials.accountSid}`; }
  private get auth() { return `Basic ${Buffer.from(`${this.credentials.accountSid}:${this.credentials.authToken}`).toString("base64")}`; }
  private async request(method: "GET" | "POST" | "DELETE", url: string, form?: Record<string, string | undefined>) {
    const body = form ? new URLSearchParams(Object.entries(form).filter((entry): entry is [string, string] => typeof entry[1] === "string")).toString() : undefined;
    const response = await this.fetchImpl(url, { method, headers: { authorization: this.auth, ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}) }, body });
    const text = await response.text();
    if (!response.ok) { let message = text.slice(0, 300); try { const parsed = JSON.parse(text) as { message?: string; code?: number }; if (parsed.message) message = `${parsed.message}${parsed.code ? ` (Code ${parsed.code})` : ""}`; } catch { /* Text */ } throw new Error(`Twilio: ${message}`); }
    try { return text ? JSON.parse(text) : {}; } catch { return {}; }
  }
  async searchNumbers(search: NumberSearch): Promise<AvailableNumber[]> {
    const params = new URLSearchParams({ VoiceEnabled: "true", PageSize: String(search.limit ?? 20) });
    if (search.contains) params.set("Contains", search.contains.replace(/[^\d*]/g, "")); if (search.region) params.set("InRegion", search.region);
    const data = await this.request("GET", `${this.base}/AvailablePhoneNumbers/${search.country}/${TYPE_MAP[search.type]}.json?${params}`) as { available_phone_numbers?: Array<{ phone_number: string; friendly_name: string; region?: string | null; locality?: string | null; capabilities?: { voice?: boolean; SMS?: boolean } }> };
    const price = await this.monthlyPrice(search.country, search.type).catch(() => null);
    return (data.available_phone_numbers ?? []).map((number) => ({ e164: number.phone_number, friendlyName: number.friendly_name, region: number.locality ?? number.region ?? null, type: search.type, monthlyPrice: price?.amount ?? null, currency: price?.currency ?? "USD", capabilities: { voice: Boolean(number.capabilities?.voice), sms: Boolean(number.capabilities?.SMS) } }));
  }
  private async monthlyPrice(country: string, type: NumberSearch["type"]) {
    const response = await this.fetchImpl(`https://pricing.twilio.com/v1/PhoneNumbers/Countries/${country}`, { headers: { authorization: this.auth } });
    if (!response.ok) return null;
    const data = await response.json() as { price_unit?: string; phone_number_prices?: Array<{ number_type: string; current_price: string }> };
    const wanted = { lokal: "local", mobil: "mobile", national: "national", kostenfrei: "toll free" }[type];
    const row = data.phone_number_prices?.find((item) => item.number_type === wanted);
    return row ? { amount: Number(row.current_price), currency: data.price_unit ?? "USD" } : null;
  }
  async purchaseNumber(e164: string, options: { friendlyName: string; voiceUrl: string; statusCallbackUrl: string; addressSid?: string | null; bundleSid?: string | null }): Promise<PurchasedNumber> {
    const data = await this.request("POST", `${this.base}/IncomingPhoneNumbers.json`, { PhoneNumber: e164, FriendlyName: options.friendlyName, VoiceUrl: options.voiceUrl, VoiceMethod: "POST", StatusCallback: options.statusCallbackUrl, AddressSid: options.addressSid ?? undefined, BundleSid: options.bundleSid ?? undefined }) as { sid: string; phone_number: string; friendly_name: string };
    return { providerSid: data.sid, e164: data.phone_number, friendlyName: data.friendly_name };
  }
  async releaseNumber(providerSid: string) { await this.request("DELETE", `${this.base}/IncomingPhoneNumbers/${providerSid}.json`); }
  async originateCall(input: OriginateInput): Promise<OriginateResult> {
    const data = await this.request("POST", `${this.base}/Calls.json`, { To: input.to, From: input.from, Url: input.answerUrl, Method: "POST", StatusCallback: input.statusCallbackUrl, StatusCallbackMethod: "POST", StatusCallbackEvent: "initiated ringing answered completed", Timeout: String(input.timeoutSeconds ?? 25), MachineDetection: input.amd ? "DetectMessageEnd" : undefined, AsyncAmd: input.amd ? "true" : undefined, AsyncAmdStatusCallback: input.amd ? input.amdCallbackUrl : undefined, AsyncAmdStatusCallbackMethod: input.amd ? "POST" : undefined }) as { sid: string };
    return { providerCallSid: data.sid };
  }
  async hangupCall(providerCallSid: string) { await this.request("POST", `${this.base}/Calls/${providerCallSid}.json`, { Status: "completed" }); }
  async redirectCall(providerCallSid: string, twimlUrl: string) { await this.request("POST", `${this.base}/Calls/${providerCallSid}.json`, { Url: twimlUrl, Method: "POST" }); }
  async startRecording(providerCallSid: string, callbackUrl: string) { const data = await this.request("POST", `${this.base}/Calls/${providerCallSid}/Recordings.json`, { RecordingChannels: "dual", RecordingStatusCallback: callbackUrl, RecordingStatusCallbackEvent: "completed" }) as { sid: string }; return { recordingSid: data.sid }; }
  /** Zugriffstoken für das Browser-Softphone (Twilio Voice SDK). */
  /** SMS/WhatsApp über die Twilio Messages-API (WhatsApp braucht einen freigeschalteten Absender „whatsapp:+…“). */
  async sendMessage(input: MessageInput): Promise<MessageResult> {
    const prefix = input.channel === "whatsapp" ? "whatsapp:" : "";
    const data = await this.request("POST", `${this.base}/Messages.json`, { From: `${prefix}${input.from}`, To: `${prefix}${input.to}`, Body: input.body, StatusCallback: input.statusCallbackUrl }) as { sid: string };
    return { providerMessageSid: data.sid, status: "gesendet" };
  }
  async accessToken(identity: string, ttlSeconds = 3600) {
    const { apiKeySid, apiKeySecret, twimlAppSid, accountSid } = this.credentials;
    if (!apiKeySid || !apiKeySecret || !twimlAppSid) return null;
    return new SignJWT({ jti: `${apiKeySid}-${Date.now()}`, grants: { identity, voice: { incoming: { allow: true }, outgoing: { application_sid: twimlAppSid } } } }).setProtectedHeader({ alg: "HS256", typ: "JWT", cty: "twilio-fpa;v=1" }).setIssuer(apiKeySid).setSubject(accountSid).setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds).sign(new TextEncoder().encode(apiKeySecret));
  }
}

/** Prüft die Twilio-Signatur eines Webhooks (X-Twilio-Signature = Base64(HMAC-SHA1(authToken, url + sortierte Parameter))). */
export function verifyTwilioSignature(authToken: string, url: string, params: Record<string, unknown>, signature: string | undefined) {
  if (!signature) return false;
  const data = url + Object.keys(params).sort().map((key) => `${key}${String(params[key] ?? "")}`).join("");
  const expected = createHmac("sha1", authToken).update(data).digest("base64");
  const a = Buffer.from(expected); const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ------------------------------------------------------------------ TwiML */

const escapeXml = (value: string) => value.replace(/[<>&"']/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char] ?? char);
export const twiml = {
  say: (text: string) => `<Say language="de-DE" voice="Polly.Vicki">${escapeXml(text)}</Say>`,
  response: (inner: string) => `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`,
  hangup: (announcement?: string) => twiml.response(`${announcement ? twiml.say(announcement) : ""}<Hangup/>`),
  dialNumber: (options: { to: string; callerId: string; record: boolean; recordingCallbackUrl?: string; statusCallbackUrl?: string; announcement?: string; timeout?: number }) => twiml.response(`${options.announcement ? twiml.say(options.announcement) : ""}<Dial callerId="${escapeXml(options.callerId)}" timeout="${options.timeout ?? 25}"${options.record ? ` record="record-from-answer-dual" recordingStatusCallback="${escapeXml(options.recordingCallbackUrl ?? "")}" recordingStatusCallbackEvent="completed"` : ""}><Number${options.statusCallbackUrl ? ` statusCallback="${escapeXml(options.statusCallbackUrl)}" statusCallbackEvent="initiated ringing answered completed"` : ""}>${escapeXml(options.to)}</Number></Dial>`),
  dialClient: (options: { identity: string; announcement?: string; timeout?: number; record: boolean; recordingCallbackUrl?: string }) => twiml.response(`${options.announcement ? twiml.say(options.announcement) : ""}<Dial timeout="${options.timeout ?? 8}"${options.record ? ` record="record-from-answer-dual" recordingStatusCallback="${escapeXml(options.recordingCallbackUrl ?? "")}" recordingStatusCallbackEvent="completed"` : ""}><Client>${escapeXml(options.identity)}</Client></Dial>${twiml.say("Leider ist gerade kein Mitarbeiter frei. Wir melden uns bei Ihnen.")}<Hangup/>`),
  enqueue: (options: { queueName: string; announcement?: string; waitUrl?: string }) => twiml.response(`${options.announcement ? twiml.say(options.announcement) : ""}<Enqueue${options.waitUrl ? ` waitUrl="${escapeXml(options.waitUrl)}"` : ""}>${escapeXml(options.queueName)}</Enqueue>`),
  dialQueue: (options: { queueName: string; record: boolean; recordingCallbackUrl?: string }) => twiml.response(`<Dial${options.record ? ` record="record-from-answer-dual" recordingStatusCallback="${escapeXml(options.recordingCallbackUrl ?? "")}" recordingStatusCallbackEvent="completed"` : ""}><Queue>${escapeXml(options.queueName)}</Queue></Dial>`),
  hold: () => twiml.response(`${twiml.say("Einen Moment bitte, Sie werden gleich verbunden.")}<Play loop="0">https://com.twilio.sounds.music.s3.amazonaws.com/MARKOVICHAMP-Borghestral.mp3</Play>`),
};

/* ------------------------------------------------------------------ Simulation */

export type SimulatedEvent = { providerCallSid: string; kind: "status" | "amd" | "recording"; payload: Record<string, unknown> };
const SIM_REGIONS: Record<string, string[]> = { DE: ["Berlin", "Hamburg", "München", "Köln", "Frankfurt", "Stuttgart"], AT: ["Wien", "Graz", "Linz", "Salzburg"], CH: ["Zürich", "Bern", "Basel", "Genf"] };
const SIM_PREFIX: Record<string, Record<string, string>> = { DE: { lokal: "+4930", mobil: "+49151", national: "+4932", kostenfrei: "+49800" }, AT: { lokal: "+431", mobil: "+43664", national: "+43720", kostenfrei: "+43800" }, CH: { lokal: "+4143", mobil: "+4179", national: "+4158", kostenfrei: "+41800" } };
const SIM_PRICE: Record<string, number> = { lokal: 1.15, mobil: 4.5, national: 1.5, kostenfrei: 2.4 };

/**
 * Simulierter Anbieter: erzeugt deterministische Rufnummern und liefert je Anruf eine Ereignisfolge, die der Dialer
 * wie echte Webhooks verarbeitet. Ausgang je nach letzter Ziffer der Zielnummer: 0/1 = Anrufbeantworter, 2 = besetzt,
 * 3 = keine Antwort, sonst Mensch nimmt ab.
 */
export class SimulationProvider implements TelephonyProvider {
  readonly name = "simulation" as const;
  readonly events: SimulatedEvent[] = [];
  private counter = 0;
  async searchNumbers(search: NumberSearch): Promise<AvailableNumber[]> {
    const prefix = SIM_PREFIX[search.country][search.type]; const regions = SIM_REGIONS[search.country];
    return Array.from({ length: Math.min(search.limit ?? 8, 12) }, (_, index) => { const suffix = String(100000 + ((index * 7919 + (search.contains?.length ?? 0) * 13) % 899999)).padStart(6, "0"); const e164 = `${prefix}${suffix}`; return { e164, friendlyName: e164.replace(/(\+\d{2})(\d{2})(\d+)/, "$1 $2 $3"), region: search.region || regions[index % regions.length], type: search.type, monthlyPrice: SIM_PRICE[search.type], currency: "EUR", capabilities: { voice: true, sms: search.type === "mobil" } }; }).filter((number) => !search.contains || number.e164.includes(search.contains.replace(/[^\d]/g, "")));
  }
  async purchaseNumber(e164: string, options: { friendlyName: string }): Promise<PurchasedNumber> { return { providerSid: `PNsim${nanoid(12)}`, e164, friendlyName: options.friendlyName }; }
  async releaseNumber() { /* nichts zu tun */ }
  async originateCall(input: OriginateInput): Promise<OriginateResult> {
    const sid = `CAsim${String(++this.counter).padStart(6, "0")}`;
    const last = Number(input.to.replace(/\D/g, "").slice(-1));
    const outcome = last <= 1 ? "machine" : last === 2 ? "busy" : last === 3 ? "no-answer" : "human";
    this.events.push({ providerCallSid: sid, kind: "status", payload: { CallSid: sid, CallStatus: "ringing" } });
    if (outcome === "busy") this.events.push({ providerCallSid: sid, kind: "status", payload: { CallSid: sid, CallStatus: "busy" } });
    else if (outcome === "no-answer") this.events.push({ providerCallSid: sid, kind: "status", payload: { CallSid: sid, CallStatus: "no-answer" } });
    else { this.events.push({ providerCallSid: sid, kind: "status", payload: { CallSid: sid, CallStatus: "in-progress" } }); if (input.amd) this.events.push({ providerCallSid: sid, kind: "amd", payload: { CallSid: sid, AnsweredBy: outcome === "machine" ? "machine_end_beep" : "human" } }); }
    return { providerCallSid: sid };
  }
  /** Beendet ein simuliertes Gespräch (mit Aufzeichnung, wenn gewünscht). */
  finishCall(providerCallSid: string, options: { durationSeconds?: number; withRecording?: boolean } = {}) {
    this.events.push({ providerCallSid, kind: "status", payload: { CallSid: providerCallSid, CallStatus: "completed", CallDuration: String(options.durationSeconds ?? 240) } });
    if (options.withRecording) this.events.push({ providerCallSid, kind: "recording", payload: { CallSid: providerCallSid, RecordingSid: `REsim${nanoid(8)}`, RecordingUrl: `https://simulation.local/recordings/${providerCallSid}.mp3`, RecordingDuration: String(options.durationSeconds ?? 240), RecordingStatus: "completed" } });
  }
  async hangupCall(providerCallSid: string) { this.finishCall(providerCallSid, { durationSeconds: 0 }); }
  async redirectCall() { /* Simulation: keine Weiterleitung nötig */ }
  async startRecording(providerCallSid: string) { return { recordingSid: `REsim${providerCallSid.slice(-6)}` }; }
  async accessToken() { return null; }
  readonly messages: MessageInput[] = [];
  async sendMessage(input: MessageInput): Promise<MessageResult> { this.messages.push(input); return { providerMessageSid: `SMsim${nanoid(10)}`, status: "simuliert" }; }
  drainEvents() { const events = [...this.events]; this.events.length = 0; return events; }
}

const simulations = new Map<number, SimulationProvider>();
export function simulationFor(tenantId: number) { const existing = simulations.get(tenantId); if (existing) return existing; const created = new SimulationProvider(); simulations.set(tenantId, created); return created; }
