import { trpc } from "@/lib/trpc";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Softphone im Browser. Bei Twilio wird das Voice SDK geladen (Mikrofon, WebRTC); in der Simulation läuft der
 * Anruf ohne Audio, damit der Ablauf trotzdem bedienbar ist.
 */
export type SoftphoneState = "aus" | "bereit" | "verbindet" | "im_gespraech" | "fehler";

export function useSoftphone() {
  const token = trpc.leadops.softphoneToken.useQuery(undefined, { retry: false, staleTime: 50 * 60 * 1000 });
  const deviceRef = useRef<any>(null); const callRef = useRef<any>(null);
  const [state, setState] = useState<SoftphoneState>("aus"); const [error, setError] = useState<string | null>(null); const [muted, setMuted] = useState(false);
  const simulated = token.data?.provider !== "twilio" || !token.data?.token;

  useEffect(() => {
    if (!token.data) return;
    if (simulated) { setState("bereit"); return; }
    let cancelled = false;
    (async () => {
      try {
        const { Device } = await import("@twilio/voice-sdk");
        const device = new Device(token.data!.token!, { codecPreferences: ["opus", "pcmu"] as any, closeProtection: true });
        device.on("registered", () => !cancelled && setState("bereit")); device.on("error", (deviceError: { message?: string }) => { if (!cancelled) { setError(deviceError.message ?? "Softphone-Fehler"); setState("fehler"); } });
        device.on("incoming", (incoming: any) => { callRef.current = incoming; incoming.accept(); setState("im_gespraech"); incoming.on("disconnect", () => { callRef.current = null; setState("bereit"); }); });
        await device.register(); deviceRef.current = device;
      } catch (loadError) { if (!cancelled) { setError(loadError instanceof Error ? loadError.message : "Softphone konnte nicht geladen werden"); setState("fehler"); } }
    })();
    return () => { cancelled = true; deviceRef.current?.destroy?.(); deviceRef.current = null; };
  }, [token.data, simulated]);

  const connect = useCallback(async (params: Record<string, string>) => {
    setError(null);
    if (simulated) { setState("verbindet"); setTimeout(() => setState("im_gespraech"), 800); return; }
    if (!deviceRef.current) throw new Error("Softphone ist nicht bereit.");
    setState("verbindet");
    const call = await deviceRef.current.connect({ params });
    callRef.current = call;
    call.on("accept", () => setState("im_gespraech")); call.on("disconnect", () => { callRef.current = null; setMuted(false); setState("bereit"); }); call.on("error", (callError: { message?: string }) => { setError(callError.message ?? "Anruffehler"); setState("bereit"); });
  }, [simulated]);

  const hangup = useCallback(() => { if (simulated) { setState("bereit"); return; } callRef.current?.disconnect?.(); deviceRef.current?.disconnectAll?.(); setState("bereit"); }, [simulated]);
  const toggleMute = useCallback(() => { const next = !muted; setMuted(next); callRef.current?.mute?.(next); }, [muted]);
  const sendDigits = useCallback((digits: string) => { callRef.current?.sendDigits?.(digits); }, []);

  return { state, error, muted, simulated, provider: token.data?.provider ?? "simulation", connect, hangup, toggleMute, sendDigits, identity: token.data?.identity ?? null };
}
