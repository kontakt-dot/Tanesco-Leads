import { CircleHelp } from "lucide-react";

/** Kopfzeile: Fragezeichen zwischen Darstellung und Mitteilungen – öffnet die Hilfe mit dem aktuellen Bereich als Kontext. */
export default function HelpButton() {
  const open = () => { let page = ""; try { page = new URLSearchParams(window.location.search).get("page") ?? ""; } catch { page = ""; } if (!page) page = document.querySelector(".flux-sidebar .nav-item.active")?.textContent?.trim() ?? "Dashboard"; window.dispatchEvent(new CustomEvent("tanesco:help", { detail: { page } })); };
  return <button type="button" className="help-button" aria-label="Hilfe – Frage stellen" title="Fragen? Die Hilfe antwortet sofort." onClick={open}><CircleHelp /></button>;
}
