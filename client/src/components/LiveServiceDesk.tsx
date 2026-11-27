import { Badge } from "@/components/ui/badge";
import TanescoAiAssistant from "@/components/TanescoAiAssistant";
import { trpc } from "@/lib/trpc";
import { ClipboardList, Mail, MessageCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/**
 * Seite „Support“: direkter Draht zum Tanesco-Team, die Anfragen der Kunden und die Schritte zum Prüfen der Plattform.
 * (Die Reklamationen haben seit v380 ihre eigene Seite: ClaimsDesk.)
 */
export default function LiveServiceDesk() {
  const whatsappUrl = "https://wa.me/491634950514?text=Hallo%20Tanesco%20Leads%2C%20ich%20brauche%20Hilfe%20bei%20...";
  const utils = trpc.useUtils();
  const [ticketFilter, setTicketFilter] = useState<"offen" | "in_bearbeitung" | "gelöst" | "geschlossen" | "">("");
  const tickets = trpc.leadops.listTickets.useQuery({ status: ticketFilter || undefined }, { retry: false });
  const updateTicket = trpc.leadops.updateTicketStatus.useMutation({ onSuccess: () => { utils.leadops.listTickets.invalidate(); toast.success("Anfrage aktualisiert."); }, onError: (error) => toast.error(error.message) });
  const testSteps = [
    ["01", "Benutzer anlegen", "Lege Käufer, Lieferant oder internen Zugang an und prüfe die Rolle."],
    ["02", "Lead-Kategorie bauen", "Erstelle eine Kategorie mit Fachfeldern und Antwortoptionen."],
    ["03", "Leads & Schnittstelle", "Lege einen Testlead an, richte im Integrationsbuilder eine Verbindung ein und sende einen Testlead."],
    ["04", "Bestellung & Lieferkette", "Erstelle eine Bestellung, wechsle in die Lieferkette und hinterlege die Verteilung."],
    ["05", "Automatisierung", "Beschreibe deinen Ablauf im Automatisierungsbuilder und prüfe die pausierte Regel."],
    ["06", "Dashboard & Statistik", "Kontrolliere Bestellverteilung, Integrationsgesundheit und die relevanten Kennzahlen."],
  ];
  const open = (tickets.data ?? []).filter((ticket) => ticket.status === "offen" || ticket.status === "in_bearbeitung").length;
  const priorityClass: Record<string, string> = { dringend: "border-red-400/25 bg-red-500/10 text-red-200", hoch: "border-amber-400/25 bg-amber-500/10 text-amber-200", normal: "border-white/15 text-slate-300", niedrig: "border-white/10 text-slate-400" };
  const statusClass: Record<string, string> = { offen: "border-sky-400/25 bg-sky-500/10 text-sky-200", in_bearbeitung: "border-amber-400/25 bg-amber-500/10 text-amber-200", gelöst: "border-emerald-400/25 bg-emerald-500/10 text-emerald-200", geschlossen: "border-white/15 text-slate-400" };
  return <>
    <header className="page-intro compact"><div><span className="eyebrow">KOMMUNIKATION · SUPPORT</span><h1>Support & Hilfe</h1><p>Anfragen deiner Kunden auf einen Blick, direkter Draht zum Tanesco-Team und die Plattformhilfe – alles an einem Ort.</p></div><Badge variant="outline" className="border-emerald-400/25 bg-emerald-500/10 text-emerald-100"><span className="live-dot" /> Team erreichbar</Badge></header>
    <div className="support-cards">
      <a className="support-card" href={whatsappUrl} target="_blank" rel="noopener noreferrer"><span className="support-card-icon is-whatsapp"><MessageCircle /></span><strong>WhatsApp-Chat</strong><span>Sofort schreiben – Screenshot oder Lead-ID beschleunigen die Lösung.</span><em>Chat öffnen →</em></a>
      <a className="support-card" href="mailto:support@tanesco.digital?subject=Tanesco%20Leads%20%E2%80%93%20Anfrage"><span className="support-card-icon is-mail"><Mail /></span><strong>E-Mail an den Support</strong><span>support@tanesco.digital – Antwort in der Regel am selben Werktag.</span><em>E-Mail schreiben →</em></a>
      <button type="button" className="support-card" onClick={() => document.getElementById("support-testplan")?.scrollIntoView({ behavior: "smooth", block: "start" })}><span className="support-card-icon is-guide"><ClipboardList /></span><strong>Plattform prüfen</strong><span>Sechs Schritte, mit denen du den kompletten Ablauf einmal durchspielst.</span><em>Zu den Schritten ↓</em></button>
    </div>
    <TanescoAiAssistant mode="support" />
    <section className="surface-panel lead-panel mt-4 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"><div><span className="eyebrow">ANFRAGEN DEINER KUNDEN</span><p className="mt-1 text-xs text-slate-500">Alles, was Kunden über „Support“ in ihrem Bereich schicken. {open ? `${open} offen.` : "Nichts offen."}</p></div><select className="filter-select h-8" value={ticketFilter} onChange={(event) => setTicketFilter(event.target.value as typeof ticketFilter)} aria-label="Status filtern"><option value="">Alle</option><option value="offen">Offen</option><option value="in_bearbeitung">In Bearbeitung</option><option value="gelöst">Gelöst</option><option value="geschlossen">Geschlossen</option></select></div>
      {tickets.isLoading ? <p className="px-5 pb-5 text-sm text-slate-400">Wird geladen …</p> : !tickets.data?.length ? <p className="px-5 pb-5 text-sm text-slate-400">Keine Anfragen{ticketFilter ? " mit diesem Status" : ""}.</p> :
        <div className="overflow-x-auto"><table className="flux-table"><thead><tr><th>Nummer</th><th>Betreff</th><th>Von</th><th>Priorität</th><th>Status</th><th>Erstellt</th><th>Aktion</th></tr></thead><tbody>{tickets.data.map((ticket) => <tr key={ticket.id}><td className="font-mono text-xs">{ticket.ticketNumber}</td><td className="font-medium text-slate-100">{ticket.subject}</td><td>{ticket.requesterName}</td><td><Badge variant="outline" className={priorityClass[ticket.priority] ?? priorityClass.normal}>{ticket.priority}</Badge></td><td><Badge variant="outline" className={statusClass[ticket.status] ?? statusClass.offen}>{ticket.status.replace("_", " ")}</Badge></td><td className="whitespace-nowrap text-xs text-slate-400">{new Date(ticket.createdAt).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}</td><td><select className="filter-select h-8" value={ticket.status} aria-label="Status ändern" onChange={(event) => updateTicket.mutate({ id: ticket.id, status: event.target.value as "offen" | "in_bearbeitung" | "gelöst" | "geschlossen" })}><option value="offen">Offen</option><option value="in_bearbeitung">In Bearbeitung</option><option value="gelöst">Gelöst</option><option value="geschlossen">Geschlossen</option></select></td></tr>)}</tbody></table></div>}
    </section>
    <section id="support-testplan" className="surface-panel mt-4 p-5"><div><span className="eyebrow">PLATTFORMTEST · SCHRITT FÜR SCHRITT</span><h2 className="mt-1 text-lg text-slate-100">So prüfst du den kompletten Operations-Flow</h2><p className="mt-1 max-w-3xl text-sm text-slate-400">Arbeite die Schritte in dieser Reihenfolge ab – so entstehen echte Daten für Lieferketten, Automatisierungen, Dashboard und Statistik. Der ausführliche Testplan liegt als TESTPLAN.md beim Quellcode.</p></div><ol className="support-steps">{testSteps.map(([number, title, description]) => <li key={number}><span className="support-step-number">{number}</span><div><strong>{title}</strong><p>{description}</p></div></li>)}</ol></section>
  </>;
}
