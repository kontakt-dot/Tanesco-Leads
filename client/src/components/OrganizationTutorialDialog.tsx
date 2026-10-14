import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { jsPDF } from "jspdf";
import { Download, FileText, HelpCircle } from "lucide-react";

type GuideKind = "personen" | "integrationen";

const guides: Record<GuideKind, { title: string; triggerLabel: string; intro: string; filename: string; sections: Array<{ title: string; text: string }> }> = {
  personen: {
    title: "Anleitung: Käufer, Lieferanten und Zugänge",
    triggerLabel: "Hilfe zur Personenanlage öffnen",
    intro: "In Tanesco Leads sind operative Partnerprofile und echte Benutzerzugänge bewusst getrennt. So können Sie sofort arbeiten, ohne dass ein Partner ein eigenes Login benötigt.",
    filename: "tanesco_leads_anleitung_kaeufer_lieferanten.pdf",
    sections: [
      { title: "1. Käufer oder Lieferant anlegen", text: "Klicken Sie auf „Käufer / Lieferant anlegen“. Geben Sie einen Namen ein, wählen Sie Käufer oder Lieferant und ergänzen Sie bei Bedarf E-Mail, Telefon sowie die passende API-Integration. Ein Login ist hierfür nicht erforderlich." },
      { title: "2. Wann verwende ich Käufer?", text: "Käufer sind die Abnehmer Ihrer Leads. Das Käuferprofil dokumentiert Ansprechpartner und API-Verbindung. Für einen späteren Systemzugang können Sie zusätzlich einen Benutzerzugang einladen." },
      { title: "3. Wann verwende ich Lieferant / Verkäufer?", text: "Lieferanten beziehungsweise Verkäufer übermitteln Leads oder bearbeiten zugeordnete Abläufe. Beim Speichern wird ein Lieferant automatisch auch für die Lead-Zuordnung bereitgestellt." },
      { title: "4. Benutzerzugang einladen", text: "Nutzen Sie „Zugang einladen“ ausschließlich, wenn die Person sich selbst in Tanesco Leads anmelden soll. Erstellen Sie die Einladung, kopieren Sie den erzeugten Link und lassen Sie die Person ihn nach der Anmeldung öffnen. Erst dann erhält sie Zugriff auf Ihren Lead-Bereich." },
      { title: "5. Typischer Ablauf", text: "Legen Sie zuerst das Käufer- oder Lieferantenprofil an. Konfigurieren Sie anschließend die API-Integration. Einen Zugang laden Sie nur für Mitarbeitende oder Partner ein, die selbst in Tanesco Leads arbeiten sollen." },
    ],
  },
  integrationen: {
    title: "Anleitung: API-Integration einrichten",
    triggerLabel: "Hilfe zur Integrationsanlage öffnen",
    intro: "Eine Integration übermittelt Daten erst dann produktiv, wenn sie über eine HTTPS-Adresse erreichbar ist, die Zugangsmethode hinterlegt wurde und der Verbindungstest erfolgreich war.",
    filename: "tanesco_leads_anleitung_api_integrationen.pdf",
    sections: [
      { title: "1. Verbindung anlegen", text: "Wählen Sie REST API oder Webhook, vergeben Sie einen eindeutigen Namen und hinterlegen Sie die HTTPS-URL des Partnerendpunkts. Interne Adressen und HTTP-Verbindungen sind aus Sicherheitsgründen nicht zulässig." },
      { title: "2. Richtung und Prozesse festlegen", text: "Wählen Sie ausgehend, wenn Tanesco Leads Leads sendet; eingehend, wenn Leads angenommen werden; oder beidseitig für Austausch. Aktivieren Sie die passenden Prozesse, beispielsweise Leads ausliefern und Statusrücklauf." },
      { title: "3. Zugang konfigurieren", text: "Bei API-Key oder Bearer-Token hinterlegen Sie den Zugangsschlüssel im sicheren Konfigurationsbereich der Karte. Ohne Zugangsmethode ist kein Schlüssel erforderlich. Zugangsdaten werden nicht in Karten oder Listen ausgegeben." },
      { title: "4. Verbindung aktivieren und testen", text: "Aktivieren Sie die Verbindung erst nach hinterlegter Zieladresse und, falls erforderlich, Zugangsdaten. Geben Sie zum Testen eine vorhandene Lead-ID ein. Tanesco Leads sendet einen HTTPS-POST und protokolliert Ergebnis, HTTP-Status und Rückmeldung." },
      { title: "5. Partner zuordnen", text: "Öffnen Sie danach den Bereich Benutzer und ordnen Sie die Integration dem passenden Käufer- oder Lieferantenprofil zu. Die Zuordnung ist sichtbar und kann jederzeit angepasst werden." },
    ],
  },
};

function downloadGuide(kind: GuideKind) {
  const guide = guides[kind];
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  pdf.setFillColor(17, 18, 40); pdf.rect(0, 0, 210, 34, "F");
  pdf.setFillColor(99, 88, 230); pdf.roundedRect(14, 9, 16, 16, 4, 4, "F");
  pdf.setTextColor(255, 255, 255); pdf.setFont("helvetica", "bold"); pdf.setFontSize(15); pdf.text("F", 22, 20.5, { align: "center" });
  pdf.setFontSize(18); pdf.text("Tanesco Leads", 35, 20); pdf.setFont("helvetica", "normal"); pdf.setFontSize(8); pdf.text("Tanesco Digital · Lead Operations", 196, 14, { align: "right" }); pdf.text("Arbeitsanleitung", 196, 20, { align: "right" });
  pdf.setTextColor(28, 29, 52); pdf.setFont("helvetica", "bold"); pdf.setFontSize(17); pdf.text(guide.title, 14, 49);
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(9); pdf.setTextColor(94, 95, 116); const intro = pdf.splitTextToSize(guide.intro, 182); pdf.text(intro, 14, 57);
  let y = 57 + intro.length * 5 + 8;
  guide.sections.forEach((section, index) => {
    const lines = pdf.splitTextToSize(section.text, 156); const height = 14 + lines.length * 4.5;
    if (y + height > 280) { pdf.addPage(); y = 20; }
    pdf.setDrawColor(221, 219, 243); pdf.roundedRect(14, y, 182, height, 2, 2, "S"); pdf.setFillColor(99, 88, 230); pdf.circle(22, y + 8.5, 4.2, "F");
    pdf.setTextColor(255, 255, 255); pdf.setFont("helvetica", "bold"); pdf.setFontSize(8); pdf.text(String(index + 1), 22, y + 10, { align: "center" });
    pdf.setTextColor(28, 29, 52); pdf.setFontSize(10); pdf.text(section.title, 31, y + 8); pdf.setFont("helvetica", "normal"); pdf.setTextColor(94, 95, 116); pdf.setFontSize(8.5); pdf.text(lines, 31, y + 14);
    y += height + 5;
  });
  pdf.setTextColor(120, 121, 145); pdf.setFontSize(7.5); pdf.text("Erstellt mit Tanesco Leads · Tanesco Digital", 14, 291); pdf.text(new Date().toLocaleDateString("de-DE"), 196, 291, { align: "right" });
  pdf.save(guide.filename);
}

export default function OrganizationTutorialDialog({ kind }: { kind: GuideKind }) {
  const guide = guides[kind];
  return <Dialog><DialogTrigger asChild><Button variant="outline" size="icon" aria-label={guide.triggerLabel} title={guide.triggerLabel}><HelpCircle className="h-4 w-4" /></Button></DialogTrigger><DialogContent className="max-h-[min(720px,calc(100vh-2rem))] max-w-2xl overflow-y-auto border-white/10 bg-slate-950 text-slate-100"><DialogHeader><div className="mb-1 flex items-center gap-2 text-violet-200"><FileText className="h-5 w-5" /><span className="eyebrow">SCHRITT-FÜR-SCHRITT</span></div><DialogTitle>{guide.title}</DialogTitle><DialogDescription className="leading-6 text-slate-400">{guide.intro}</DialogDescription></DialogHeader><div className="space-y-3">{guide.sections.map((section) => <article key={section.title} className="rounded-xl border border-white/8 bg-white/[.025] p-4"><h3 className="text-sm font-semibold text-slate-100">{section.title}</h3><p className="mt-1.5 text-sm leading-6 text-slate-400">{section.text}</p></article>)}</div><DialogFooter><Button variant="outline" onClick={() => downloadGuide(kind)}><Download /> Anleitung als PDF herunterladen</Button></DialogFooter></DialogContent></Dialog>;
}
