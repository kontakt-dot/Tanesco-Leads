import TanescoAiAssistant from "@/components/TanescoAiAssistant";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * Dezente Hilfe: In jedem Bereich sitzt ein kleines „?“ neben der Überschrift (setzt lib/pageHelp ein). Ein Klick öffnet
 * diese Schublade mit der Frage „Wie funktioniert <Bereich>?“ – die Antwort kommt sofort aus der Wissensbasis.
 */
export default function AssistantLauncher() {
  const [state, setState] = useState<{ open: boolean; page: string | null; question: string }>({ open: false, page: null, question: "" });
  useEffect(() => {
    const onHelp = (event: Event) => { const detail = (event as CustomEvent<{ page?: string }>).detail ?? {}; const page = detail.page ?? null; setState({ open: true, page, question: page ? `Wie funktioniert der Bereich „${page}“?` : "Wie funktioniert die Plattform?" }); };
    window.addEventListener("tanesco:help", onHelp); return () => window.removeEventListener("tanesco:help", onHelp);
  }, []);
  useEffect(() => { if (!state.open) return; const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setState((value) => ({ ...value, open: false })); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [state.open]);
  if (!state.open) return null;
  return <div className="side-drawer-backdrop" onClick={() => setState((value) => ({ ...value, open: false }))} role="presentation"><aside className="side-drawer assistant-drawer" role="dialog" aria-label="Hilfe" onClick={(event) => event.stopPropagation()}><header className="side-drawer-head"><div><span className="eyebrow">HILFE{state.page ? ` · ${state.page.toUpperCase()}` : ""}</span><h2 className="mt-1 text-base font-semibold text-slate-100">Frag einfach – die Antwort kommt sofort</h2><p className="text-xs text-slate-500">Zu diesem Bereich oder zu allem anderen: Leads, Bestellungen, Lieferketten, Integrationen, Fehler.</p></div><Button size="icon" variant="ghost" aria-label="Hilfe schließen" onClick={() => setState((value) => ({ ...value, open: false }))}><X className="h-4 w-4" /></Button></header><div className="side-drawer-body"><TanescoAiAssistant key={state.page ?? "all"} mode="support" page={state.page} initialQuestion={state.question} autoAsk /></div></aside></div>;
}
