import { Button } from "@/components/ui/button";
import AutomationBuilder from "@/components/AutomationBuilder";
import IntegrationBuilder from "@/components/IntegrationBuilder";
import { ChevronDown, Sparkles, Wand2 } from "lucide-react";
import { useState, type ComponentProps } from "react";

/**
 * Builder direkt auf der Seite (wie der Kategorien-Builder): Teaser-Karte mit Beschreibung, aufklappbar –
 * darunter erscheint der Builder in voller Breite, ohne Schublade.
 */
export function InlineAutomationBuilder(props: ComponentProps<typeof AutomationBuilder>) {
  const [open, setOpen] = useState(false);
  return <section className="category-builder-teaser inline-builder"><div className="inline-builder-head"><div><span className="eyebrow">NEUE AUTOMATISIERUNG AUS BESCHREIBUNG</span><strong>In einem Satz sagen, was passieren soll – der Builder legt die Regel an</strong><p>Zum Beispiel: „Wenn ein PV-Lead erstellt wird, prüfe ihn und ordne ihn danach einer Bestellung zu.“ Die Regel entsteht pausiert und wird hier direkt sichtbar.</p></div><Button variant="outline" onClick={() => setOpen((value) => !value)} aria-expanded={open}><Sparkles /> Automatisierungsbuilder <ChevronDown className={`inline-builder-chevron ${open ? "open" : ""}`} /></Button></div>{open && <div className="inline-builder-body"><AutomationBuilder {...props} /></div>}</section>;
}

export function InlineIntegrationBuilder({ onCreated }: { onCreated: (integrationId: number | null) => void }) {
  const [open, setOpen] = useState(false);
  return <section className="category-builder-teaser inline-builder"><div className="inline-builder-head"><div><span className="eyebrow">NEUE INTEGRATION AUS UNTERLAGEN</span><strong>Partner-Dokumentation einfügen, Schnittstelle automatisch vorbereiten</strong><p>Der Integrationsbuilder liest API-Dokumentationen, Beispielaufrufe oder Feldlisten und erstellt daraus eine zunächst inaktive, prüfbare Verbindung.</p></div><Button variant="outline" onClick={() => setOpen((value) => !value)} aria-expanded={open}><Wand2 /> Integrationsbuilder <ChevronDown className={`inline-builder-chevron ${open ? "open" : ""}`} /></Button></div>{open && <div className="inline-builder-body"><IntegrationBuilder onCreated={(id) => { onCreated(id); }} /></div>}</section>;
}
