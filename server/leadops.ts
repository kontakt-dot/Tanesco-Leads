export const leadStatuses = ["alle", "genehmigt", "zugewiesen", "reklamiert", "fehlerhaft", "hängend", "deaktiviert"] as const;
export type LeadStatusFilter = (typeof leadStatuses)[number];

export type LeadSummary = {
  status: Exclude<LeadStatusFilter, "alle"> | "neu";
  cost: number;
  createdAt: Date;
  email?: string | null;
  phone?: string | null;
};

export function computeDashboardKpis(leads: LeadSummary[]) {
  const delivered = leads.filter((lead) => lead.status === "zugewiesen").length;
  const revenue = leads
    .filter((lead) => lead.status === "zugewiesen")
    .reduce((total, lead) => total + lead.cost, 0);
  const complaints = leads.filter((lead) => lead.status === "reklamiert").length;
  const registrations = leads.filter((lead) => lead.status === "neu" || lead.status === "genehmigt").length;
  const identifiers = new Map<string, number>();
  for (const lead of leads) { const email = lead.email?.trim().toLowerCase(); const phone = lead.phone?.replace(/\D/g, ""); const key = email ? `email:${email}` : phone ? `phone:${phone}` : undefined; if (key) identifiers.set(key, (identifiers.get(key) ?? 0) + 1); }
  const duplicates = leads.filter((lead) => { const email = lead.email?.trim().toLowerCase(); const phone = lead.phone?.replace(/\D/g, ""); const key = email ? `email:${email}` : phone ? `phone:${phone}` : undefined; return Boolean(key && (identifiers.get(key) ?? 0) > 1); }).length;

  return { delivered, revenue, registrations, duplicates, complaints };
}

export function makeCsv(rows: Array<Record<string, string | number | null | undefined>>) {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (value: string | number | null | undefined) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [headers.join(";"), ...rows.map((row) => headers.map((header) => escape(row[header])).join(";"))].join("\n");
}
