import { describe, expect, it } from "vitest";
import { SimulationProvider } from "./telephony-provider";

describe("Telefonie-Anbieter (Simulation)", () => {
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
  it("simuliert SMS und merkt sie sich; WhatsApp ebenfalls (nur Simulation)", async () => {
    const provider = new SimulationProvider();
    const sms = await provider.sendMessage({ channel: "sms", from: "+4930999", to: "+49151", body: "Hallo" });
    expect(sms.status).toBe("simuliert"); expect(provider.messages).toHaveLength(1);
  });
});
