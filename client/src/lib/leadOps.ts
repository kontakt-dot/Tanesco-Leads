export type LeadStatus = "Genehmigt" | "Zugewiesen" | "Reklamiert" | "Fehlerhaft" | "Deaktiviert" | "Hängend";

export type LeadRecord = {
  id: string;
  type: string;
  name: string;
  location: string;
  phone: string;
  email: string;
  status: LeadStatus;
  created: string;
  price: number;
  buyer: string;
  supplier: string;
  country: "DE" | "AT" | "CH";
};

export const demoLeads: LeadRecord[] = [
  { id: "LX-48A90", type: "PV", name: "Alex Weber", location: "50667 Köln", phone: "+49 151 00000001", email: "alex.weber@beispiel.de", status: "Zugewiesen", created: "Heute, 16:44", price: 42, buyer: "Nordlicht Energie", supplier: "Signal Ads", country: "DE" },
  { id: "LX-4B210", type: "PV", name: "Lina Hoffmann", location: "70173 Stuttgart", phone: "+49 151 00000002", email: "lina.hoffmann@beispiel.de", status: "Zugewiesen", created: "Heute, 16:40", price: 38, buyer: "Aurora Home", supplier: "Orbit Media", country: "DE" },
  { id: "LX-4B211", type: "WP", name: "David Kühn", location: "80331 München", phone: "+49 151 00000003", email: "david.kuehn@beispiel.de", status: "Reklamiert", created: "Heute, 16:40", price: 29, buyer: "Vektor Klima", supplier: "Signal Ads", country: "DE" },
  { id: "LX-4B212", type: "PV", name: "Mira Scholz", location: "01067 Dresden", phone: "+49 151 00000004", email: "mira.scholz@beispiel.de", status: "Genehmigt", created: "Heute, 16:38", price: 34, buyer: "—", supplier: "Flux Ads", country: "DE" },
  { id: "LX-4B213", type: "FEN", name: "Elif Aydin", location: "8001 Zürich", phone: "+41 79 0000005", email: "elif.aydin@beispiel.ch", status: "Hängend", created: "Heute, 16:32", price: 25, buyer: "—", supplier: "Vector Reach", country: "CH" },
  { id: "LX-4B214", type: "PV", name: "Jonas Berger", location: "40213 Düsseldorf", phone: "+49 151 00000006", email: "jonas.berger@beispiel.de", status: "Fehlerhaft", created: "Heute, 16:27", price: 0, buyer: "—", supplier: "Signal Ads", country: "DE" },
  { id: "LX-4B215", type: "WP", name: "Nora Becker", location: "10115 Berlin", phone: "+49 151 00000007", email: "nora.becker@beispiel.de", status: "Deaktiviert", created: "Heute, 16:19", price: 18, buyer: "—", supplier: "Orbit Media", country: "DE" },
];

export const currency = (value: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value);

export const statusTone: Record<LeadStatus, string> = {
  Genehmigt: "bg-sky-500/10 text-sky-300 border-sky-400/20",
  Zugewiesen: "bg-emerald-500/10 text-emerald-300 border-emerald-400/20",
  Reklamiert: "bg-orange-500/10 text-orange-300 border-orange-400/20",
  Fehlerhaft: "bg-rose-500/10 text-rose-300 border-rose-400/20",
  Deaktiviert: "bg-slate-500/10 text-slate-300 border-slate-400/20",
  Hängend: "bg-amber-500/10 text-amber-200 border-amber-400/20",
};

