import { UndoBridge } from "@/components/UndoPanel";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import ErrorBoundary from "@/components/ErrorBoundary";
import { ThemeProvider } from "@/contexts/ThemeContext";
import Home from "@/pages/Home";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { callProcedure, getStore, resetStore } from "./backend";
// Chat-Build: eingebettete Kundenseiten (z. B. Vertrag unterschreiben) erreichen den Demo-Speicher über dieses Fenster-Objekt
window.__tanescoDemo = { reset: () => resetStore(), call: (path: string, input: unknown) => callProcedure(path, input), store: () => getStore() };

function DemoBadge() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const timer = window.setTimeout(() => setArmed(false), 6000); return () => window.clearTimeout(timer); }, [armed]);
  const reset = async () => {
    if (busy) return;
    if (!armed) { setArmed(true); return; }
    setArmed(false);
    setBusy(true);
    resetStore();
    try { window.history.replaceState(null, "", "/?page=Dashboard"); } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent("fluxora:navigate", { detail: { page: "Dashboard" } }));
    await queryClient.invalidateQueries();
    setBusy(false);
  };
  return <div className="demo-badge" style={{ position: "fixed", right: 14, bottom: 14, zIndex: 60, display: "flex", alignItems: "center", gap: 10, padding: "6px 10px 6px 12px", borderRadius: 999, border: "1px solid rgba(167,139,250,.35)", background: "rgba(17,18,40,.92)", color: "#cbd5e1", fontSize: 11, letterSpacing: ".02em", boxShadow: "0 10px 30px rgba(0,0,0,.35)", backdropFilter: "blur(8px)" }}>
    <span style={{ width: 7, height: 7, borderRadius: 999, background: "#8e86ff", boxShadow: "0 0 10px #8e86ff" }} />
    <span><span className="demo-badge-text">Chat-Demo · Daten liegen nur in diesem Browser</span><span className="demo-badge-short">Demo</span></span>
    <button type="button" onClick={reset} disabled={busy} title="Setzt alle Demodaten dieser Ansicht auf den Ausgangszustand zurück" style={{ border: "1px solid rgba(255,255,255,.12)", borderRadius: 999, padding: "3px 9px", background: armed ? "#5247e8" : "rgba(255,255,255,.05)", color: "#e2e8f0", cursor: "pointer", fontSize: 11 }}>{busy ? "…" : armed ? "Wirklich? Erneut klicken" : "Zurücksetzen"}</button>
  </div>;
}

export default function DemoApp() {
  return <ErrorBoundary><ThemeProvider defaultTheme="dark" switchable><TooltipProvider><Toaster richColors theme="dark" position="top-right" /><UndoBridge /><Home /><DemoBadge /></TooltipProvider></ThemeProvider></ErrorBoundary>;
}
