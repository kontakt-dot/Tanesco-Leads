/**
 * Telefonie-Anbieter hinter dem Dialer.
 *  - sipgate (server/sipgate-provider.ts): Anrufe über das sipgate-Gerät des Agenten, Rufnummern aus dem sipgate-Konto, Aufzeichnung, SMS.
 *  - simulation: gleiches Verhalten ohne echte Telefonie (Chat-Build, Tests, Einrichtung ohne Konto).
 */
import { nanoid } from "nanoid";

export type NumberSearch = { country: "DE" | "AT" | "CH"; type: "lokal" | "mobil" | "national" | "kostenfrei"; contains?: string; region?: string; limit?: number };
export type AvailableNumber = { e164: string; friendlyName: string; region: string | null; type: NumberSearch["type"]; monthlyPrice: number | null; currency: string; capabilities: { voice: boolean; sms: boolean } };
export type PurchasedNumber = { providerSid: string; e164: string; friendlyName: string };
export type OriginateInput = { to: string; from: string; answerUrl: string; statusCallbackUrl: string; amd: boolean; amdCallbackUrl?: string; timeoutSeconds?: number; reference: string; deviceId?: string | null };
export type OriginateResult = { providerCallSid: string; providerSessionId?: string | null };

export interface TelephonyProvider {
  readonly name: "simulation" | "sipgate";
  searchNumbers(search: NumberSearch): Promise<AvailableNumber[]>;
  purchaseNumber(e164: string, options: { friendlyName: string; voiceUrl: string; statusCallbackUrl: string; country: string; addressSid?: string | null; bundleSid?: string | null }): Promise<PurchasedNumber>;
  releaseNumber(providerSid: string): Promise<void>;
  originateCall(input: OriginateInput): Promise<OriginateResult>;
  hangupCall(providerCallSid: string): Promise<void>;
  startRecording(providerCallSid: string, callbackUrl: string, options?: { announcement?: boolean }): Promise<{ recordingSid: string }>;
  accessToken(identity: string, ttlSeconds?: number): Promise<string | null>;
  /** Textnachricht (SMS oder WhatsApp) senden; from/to in E.164. */
  sendMessage(input: MessageInput): Promise<MessageResult>;
}
export type MessageInput = { channel: "sms" | "whatsapp"; from: string; to: string; body: string; statusCallbackUrl?: string };
export type MessageResult = { providerMessageSid: string; status: "gesendet" | "simuliert" };

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
  async startRecording(providerCallSid: string) { return { recordingSid: `REsim${providerCallSid.slice(-6)}` }; }
  async accessToken() { return null; }
  readonly messages: MessageInput[] = [];
  async sendMessage(input: MessageInput): Promise<MessageResult> { this.messages.push(input); return { providerMessageSid: `SMsim${nanoid(10)}`, status: "simuliert" }; }
  drainEvents() { const events = [...this.events]; this.events.length = 0; return events; }
}

const simulations = new Map<number, SimulationProvider>();
export function simulationFor(tenantId: number) { const existing = simulations.get(tenantId); if (existing) return existing; const created = new SimulationProvider(); simulations.set(tenantId, created); return created; }
