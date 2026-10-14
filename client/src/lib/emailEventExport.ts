export type EmailEventExportRow = { recipientEmail: string; subject: string; deliveryStatus: string; createdAt: Date };

export function buildEmailEventsCsv(events: readonly EmailEventExportRow[]) {
  const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return ["Empfänger;Betreff;Zustellstatus;Zeitpunkt", ...events.map((event) => [event.recipientEmail, event.subject, event.deliveryStatus, new Date(event.createdAt).toISOString()].map(escape).join(";"))].join("\n");
}

export function downloadEmailEventsCsv(events: readonly EmailEventExportRow[]) {
  const url = URL.createObjectURL(new Blob([buildEmailEventsCsv(events)], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = "email-zustellverlauf.csv"; anchor.click(); URL.revokeObjectURL(url);
}
