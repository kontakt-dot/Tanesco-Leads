import { trpc } from "@/lib/trpc";
import { useCallback, useState } from "react";

/**
 * Leitungs-Zustand im Browser. Es gibt kein Browser-Softphone mehr: Bei sipgate klingelt das sipgate-Gerät des Agenten
 * (App, Tischtelefon, Handy), in der Simulation läuft der Anruf ohne Audio, damit der Ablauf trotzdem bedienbar ist.
 * `connect`/`hangup` halten nur den Zustand für die Oberfläche fest.
 */
export type SoftphoneState = "aus" | "bereit" | "verbindet" | "im_gespraech" | "fehler";

export function useSoftphone() {
  const token = trpc.leadops.softphoneToken.useQuery(undefined, { retry: false, staleTime: 50 * 60 * 1000 });
  const [state, setState] = useState<SoftphoneState>("bereit"); const [muted, setMuted] = useState(false);
  const provider = token.data?.provider ?? "simulation";
  const connect = useCallback(async (_params: Record<string, string>) => { setState("verbindet"); setTimeout(() => setState("im_gespraech"), 800); }, []);
  const hangup = useCallback(() => { setState("bereit"); setMuted(false); }, []);
  const toggleMute = useCallback(() => setMuted((value) => !value), []);
  const sendDigits = useCallback((_digits: string) => { /* ohne Browser-Softphone nichts zu tun */ }, []);
  return { state, error: null as string | null, muted, simulated: provider !== "sipgate", provider, connect, hangup, toggleMute, sendDigits, identity: token.data?.identity ?? null };
}
